import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  useCommunityBans,
  useCommunityDetail,
  useCommunityMembers,
  useMyCommunityStatus,
  useTransferCommunityAdmin,
  useUnbanCommunityMember,
  useUpdateCommunityInfo,
  type CommunityDetail,
} from '@/features/community/api'
import { BanMemberDialog } from '@/features/community/ban-member-dialog'
import { ConfirmDialog } from '@/features/community/dialog'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Input, Textarea } from '@/shared/ui/field'
import { Group, GroupFooter, GroupHeader, groupRowClass } from '@/shared/ui/group'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'
import { absoluteDate, absoluteDateTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

/** 与后端 @Size / Flyway 列宽是同一组数字，改一处必须改三处 */
const MAX_DESCRIPTION = 500
const MAX_AVATAR = 512
const MAX_ANNOUNCEMENT = 1000

type Tab = 'info' | 'bans' | 'transfer'

const TABS: Array<{ value: Tab; label: string; testId: string }> = [
  { value: 'info', label: '社群信息', testId: 'manage-tab-info' },
  { value: 'bans', label: '封禁管理', testId: 'manage-tab-bans' },
  { value: 'transfer', label: '管理员转让', testId: 'manage-tab-transfer' },
]

/**
 * 管理台（`/c/:name/manage`，需登录）。
 *
 * 三条结构决定：
 *
 * 1. **独立单栏页面**，不塞进社群双栏。管理是"离开社群去改设置"的动作，
 *    左栏的帖子列表在这里只会让人误以为改完就自动生效了。
 * 2. **权限判断在后端，前端只负责不展示死路**。非管理员看到的是
 *    `manage-forbidden` + 返回链接，而不是三个点进去必然 403 的 Tab。
 * 3. **三个 Tab 各自挂载**。封禁管理会拉成员与封禁两个列表，转让只需要成员；
 *    用条件挂载让没打开的 Tab 一个请求都不发。
 */
export function CommunityManagePage() {
  const { name } = useParams<{ name: string }>()
  const status = useMyCommunityStatus(name)
  const detail = useCommunityDetail(name)
  const [tab, setTab] = useState<Tab>('info')

  const communityName = detail.data?.name ?? name ?? ''

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] bg-surface" data-testid="community-manage-page">
      <div className="mx-auto w-full max-w-[980px] px-6 pb-24 pt-12">
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline"
          data-testid="manage-back-link"
        >
          ← 返回 {communityName}
        </Link>

        <header className="mt-5 mb-8">
          <h1 className="m-0 text-title">管理 {communityName}</h1>
          <p className="m-0 mt-2 max-w-[38rem] text-read text-muted-foreground">
            编辑社群信息、管理封禁、把管理权交给别人。
          </p>
        </header>

        {status.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-72 rounded-full" />
            <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
          </div>
        ) : status.isError ? (
          <p className="m-0 text-body text-danger" data-testid="manage-error">
            {authErrorMessage(status.error)}
          </p>
        ) : status.data?.admin !== true ? (
          // 非管理员：说清"为什么看不到"以及"谁能看到"，而不是一个空白页
          <Group>
            <Empty
              title="只有社群管理员可以进入这里"
              description="如果你刚刚接手这个社群，刷新页面即可；管理员是唯一的一个人。"
              testId="manage-forbidden"
              action={
                <Link
                  to={`/c/${encodeURIComponent(name ?? '')}`}
                  className="text-aux text-primary hover:underline"
                >
                  返回社群
                </Link>
              }
            />
          </Group>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-3 overflow-x-auto pb-1">
              <Segmented value={tab} onChange={setTab} options={TABS} />
            </div>

            <div role="tabpanel">
              {tab === 'info' ? (
                detail.isPending ? (
                  <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
                ) : detail.isError ? (
                  <p className="m-0 text-aux text-danger">{authErrorMessage(detail.error)}</p>
                ) : (
                  // key 用社群 id：切社群时表单重新挂载，输入值不会串到另一个社群
                  <InfoTab key={detail.data.id ?? communityName} name={name} community={detail.data} />
                )
              ) : null}
              {tab === 'bans' ? <BansTab name={name} adminUserId={detail.data?.ownerId} /> : null}
              {tab === 'transfer' ? (
                <TransferTab name={name} adminUserId={detail.data?.ownerId} />
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 社群信息

/**
 * 编辑简介 / 头像 / 公告。
 *
 * 提交时**三个字段都发字符串**：契约是 null = 不改、"" = 清空，
 * 输入框被清空正好就是 ""。这样不需要"哪些字段改过"的影子状态，
 * 也不会出现"只改公告却顺手抹掉头像"（那是把 null 当清空的经典事故）。
 */
function InfoTab({ name, community }: { name: string | undefined; community: CommunityDetail }) {
  const update = useUpdateCommunityInfo(name)
  const [description, setDescription] = useState(community.description ?? '')
  const [avatarUrl, setAvatarUrl] = useState(community.avatarUrl ?? '')
  const [announcement, setAnnouncement] = useState(community.announcement ?? '')
  const [error, setError] = useState<string | null>(null)

  const trimmedAvatar = avatarUrl.trim()
  // 与后端同一个白名单：只有 http/https 能进 <img src>。
  // 在这里提前说，比让人点了保存再吃一个 40010 好。
  const avatarInvalid = trimmedAvatar !== '' && !/^https?:\/\//i.test(trimmedAvatar)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (avatarInvalid) return
    setError(null)
    update.mutate(
      { description, avatarUrl, announcement },
      {
        onSuccess: () => toast('社群信息已保存'),
        onError: (err) => setError(authErrorMessage(err)),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate>
      <GroupHeader className="px-1">简介</GroupHeader>
      <Group className="p-4">
        <label className="block">
          <span className="mb-2 block text-caption text-muted-foreground">
            最多 {MAX_DESCRIPTION} 字
          </span>
          <Textarea
            data-testid="field-community-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRIPTION}
            rows={5}
          />
        </label>
      </Group>

      <GroupHeader className="mt-9 px-1">头像</GroupHeader>
      <Group className="p-4">
        <div className="flex items-start gap-4">
          {/* 实时预览：贴一个坏链接时立刻看得出来（Avatar 内部还会再过一遍协议白名单） */}
          <Avatar url={trimmedAvatar === '' ? null : trimmedAvatar} name={community.name ?? ''} size={56} />
          <label className="block min-w-0 flex-1">
            <span className="mb-2 block text-caption text-muted-foreground">
              头像外链（最多 {MAX_AVATAR} 字）
            </span>
            <Input
              data-testid="field-community-avatar"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              maxLength={MAX_AVATAR}
              placeholder="https://…"
              aria-invalid={avatarInvalid}
            />
            {avatarInvalid ? (
              <span className="mt-1.5 block text-caption text-danger" data-testid="avatar-url-invalid">
                头像链接必须以 http:// 或 https:// 开头
              </span>
            ) : (
              <span className="mt-1.5 block text-caption text-faint">
                留空会退回首字母头像。
              </span>
            )}
          </label>
        </div>
      </Group>

      <GroupHeader className="mt-9 px-1">公告</GroupHeader>
      <Group className="p-4">
        <label className="block">
          <span className="mb-2 block text-caption text-muted-foreground">
            最多 {MAX_ANNOUNCEMENT} 字
          </span>
          <Textarea
            data-testid="field-community-announcement"
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            maxLength={MAX_ANNOUNCEMENT}
            rows={5}
            placeholder="社群规则、活动通知…会显示在社群首页"
          />
        </label>
        <GroupFooter className="px-0">纯文本，换行会保留。</GroupFooter>
      </Group>

      {error ? (
        <p className="m-0 mt-5 text-aux text-danger" data-testid="manage-info-error">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button
          type="submit"
          disabled={update.isPending || avatarInvalid}
          data-testid="btn-save-community-info"
        >
          {update.isPending ? '保存中…' : '保存'}
        </Button>
        {update.isSuccess && !update.isPending ? (
          <span className="text-aux text-success" data-testid="manage-info-saved">
            已保存
          </span>
        ) : null}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- 封禁管理

/**
 * 封禁管理 = 生效封禁名单（可解封）+ 在社成员名单（可封禁）。
 *
 * 两块用**同一份**批量昵称头像数据：成员与封禁对象都是用户 id，
 * 各查各的就是两次 N+1。
 */
function BansTab({ name, adminUserId }: { name: string | undefined; adminUserId: string | undefined }) {
  const bans = useCommunityBans(name)
  const members = useCommunityMembers(name)
  const unban = useUnbanCommunityMember(name)
  const [filter, setFilter] = useState('')
  const [banTarget, setBanTarget] = useState<{ userId: string; nickname: string } | null>(null)

  const banItems = (bans.data?.pages ?? []).flatMap((p) => p.items ?? [])
  const memberItems = (members.data?.pages ?? []).flatMap((p) => p.items ?? [])

  const summaries = useUserSummaries([
    ...banItems.flatMap((b) => [b.userId, b.bannedBy]),
    ...memberItems.map((m) => m.userId),
  ])
  const nicknameOf = (userId: string | undefined) =>
    pickAuthor(summaries.data, userId)?.nickname ?? (summaries.isPending ? '…' : '已注销用户')

  // 本地筛选：成员名单已经按页取回来了，再发一个带 q 的请求只会让
  // "我正在看的那一行"在筛选时消失又出现
  const query = filter.trim().toLowerCase()
  const visibleMembers =
    query === ''
      ? memberItems
      : memberItems.filter((m) =>
          (pickAuthor(summaries.data, m.userId)?.nickname ?? '').toLowerCase().includes(query),
        )

  return (
    <>
      <section className="mb-12">
        <GroupHeader className="px-1">生效中的封禁</GroupHeader>
        <Group data-testid="ban-list">
          {bans.isPending ? (
            <div className="px-4 py-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : bans.isError ? (
            <p className="m-0 px-4 py-4 text-aux text-danger" data-testid="ban-list-error">
              {authErrorMessage(bans.error)}
            </p>
          ) : banItems.length === 0 ? (
            <Empty
              title="当前没有被封禁的用户"
              description="封禁会同时把 ta 移出社群，并禁止再次加入、发帖与评论。"
              testId="ban-list-empty"
            />
          ) : (
            <ul className="m-0 list-none p-0">
              {banItems.map((b) => (
                <li
                  key={b.userId}
                  className={groupRowClass({ className: 'flex-col items-stretch gap-1.5 py-4' })}
                  data-testid="ban-item"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Link
                      to={`/u/${encodeURIComponent(b.userId ?? '')}`}
                      className="inline-flex min-w-0 items-center gap-2.5 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
                    >
                      <Avatar
                        url={pickAuthor(summaries.data, b.userId)?.avatarUrl ?? null}
                        name={nicknameOf(b.userId)}
                        size={32}
                      />
                      <span className="truncate text-body font-medium text-foreground">
                        {nicknameOf(b.userId)}
                      </span>
                    </Link>
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      <span className="text-caption tabular-nums text-faint">
                        {b.expiresAt ? `至 ${absoluteDateTime(b.expiresAt)}` : '永久'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={unban.isPending}
                        onClick={() => {
                          unban.mutate(b.userId ?? '', {
                            onSuccess: () => toast('已解封'),
                            onError: (err) => toast(authErrorMessage(err)),
                          })
                        }}
                        data-testid="btn-unban"
                      >
                        解封
                      </Button>
                    </div>
                  </div>
                  <p className="m-0 text-caption leading-[1.6] text-muted-foreground">
                    {b.reason ? `原因：${b.reason}` : '未填写原因'}
                    {' · '}
                    封禁人 {nicknameOf(b.bannedBy)}
                    {' · '}
                    {absoluteDate(b.bannedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Group>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <GroupHeader className="p-0">在社成员</GroupHeader>
          <Input
            data-testid="field-member-filter"
            className="h-9 w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="按昵称筛选"
          />
        </div>
        <Group data-testid="member-list">
          {members.isPending ? (
            <div className="px-4 py-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : members.isError ? (
            <p className="m-0 px-4 py-4 text-aux text-danger" data-testid="member-list-error">
              {authErrorMessage(members.error)}
            </p>
          ) : visibleMembers.length === 0 ? (
            <Empty
              title={query === '' ? '还没有成员' : '没有匹配的成员'}
              description={query === '' ? '有人加入后会出现在这里。' : '换个昵称试试。'}
              testId="member-list-empty"
            />
          ) : (
            <ul className="m-0 list-none p-0">
              {visibleMembers.map((m) => {
                const isAdmin = m.admin === true || m.userId === adminUserId
                const nickname = nicknameOf(m.userId)
                return (
                  <li key={m.userId} className={groupRowClass()} data-testid="member-item">
                    <Link
                      to={`/u/${encodeURIComponent(m.userId ?? '')}`}
                      className="inline-flex min-w-0 items-center gap-2.5 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
                    >
                      <Avatar
                        url={pickAuthor(summaries.data, m.userId)?.avatarUrl ?? null}
                        name={nickname}
                        size={32}
                      />
                      <span className="truncate text-body font-medium text-foreground">
                        {nickname}
                      </span>
                    </Link>
                    {isAdmin ? (
                      <span className="inline-flex h-[20px] items-center rounded-full bg-fill px-2 text-caption font-medium text-muted-foreground">
                        管理员
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-caption tabular-nums text-faint">
                      {absoluteDate(m.joinedAt)} 加入
                    </span>
                    {/* 管理员本人那一行不给封禁入口：后端会是 41008 */}
                    {isAdmin ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBanTarget({ userId: m.userId ?? '', nickname })}
                        data-testid="btn-ban-member"
                      >
                        封禁
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Group>

        {members.hasNextPage ? (
          <button
            type="button"
            onClick={() => void members.fetchNextPage()}
            disabled={members.isFetchingNextPage}
            className="mt-2 w-full rounded-full py-3 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground disabled:opacity-50"
            data-testid="btn-load-more-members"
          >
            {members.isFetchingNextPage ? '加载中…' : '加载更多成员'}
          </button>
        ) : null}
      </section>

      {banTarget ? (
        <BanMemberDialog
          communityName={name}
          targetUserId={banTarget.userId}
          targetNickname={banTarget.nickname}
          onClose={() => setBanTarget(null)}
        />
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------- 转让

/**
 * 管理员转让。
 *
 * 只列**在社的普通成员**（管理员自己那行不出现——转让给自己是 41009）。
 * 二次确认必须说清"你会变成普通成员"，否则点下去的人以为只是"加一个管理员"。
 */
function TransferTab({ name, adminUserId }: { name: string | undefined; adminUserId: string | undefined }) {
  const members = useCommunityMembers(name)
  const transfer = useTransferCommunityAdmin(name)
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidates = (members.data?.pages ?? [])
    .flatMap((p) => p.items ?? [])
    .filter((m) => m.admin !== true && m.userId !== adminUserId)

  const summaries = useUserSummaries(candidates.map((m) => m.userId))
  const nicknameOf = (userId: string | undefined) =>
    pickAuthor(summaries.data, userId)?.nickname ?? (summaries.isPending ? '…' : '已注销用户')

  const selectedNickname = selected ? nicknameOf(selected) : ''

  return (
    <>
      <GroupHeader className="px-1">转让给谁</GroupHeader>
      <Group data-testid="transfer-candidate-list">
        {members.isPending ? (
          <div className="px-4 py-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : members.isError ? (
          <p className="m-0 px-4 py-4 text-aux text-danger" data-testid="transfer-error">
            {authErrorMessage(members.error)}
          </p>
        ) : candidates.length === 0 ? (
          <Empty
            title="本社群还没有其他成员"
            description="转让只能给在社且未被封禁的成员。等人加入之后再回来。"
            testId="transfer-empty"
          />
        ) : (
          <ul className="m-0 list-none p-0">
            {candidates.map((m) => {
              const active = m.userId === selected
              return (
                <li key={m.userId} className="p-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelected(m.userId ?? null)
                      setError(null)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-[var(--duration-fast)]',
                      active ? 'bg-primary-soft' : 'hover:bg-fill',
                    )}
                    data-testid="transfer-member-item"
                  >
                    <Avatar
                      url={pickAuthor(summaries.data, m.userId)?.avatarUrl ?? null}
                      name={nicknameOf(m.userId)}
                      size={32}
                    />
                    <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                      {nicknameOf(m.userId)}
                    </span>
                    <span className="shrink-0 text-caption tabular-nums text-faint">
                      {absoluteDate(m.joinedAt)} 加入
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'ml-1.5 h-4 w-4 shrink-0 rounded-full border transition-colors duration-[var(--duration-fast)]',
                        active ? 'border-primary bg-primary' : 'border-border-strong',
                      )}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Group>
      <GroupFooter>
        转让后你会变成普通成员，不再能编辑信息、封禁或删除他人的帖子。
      </GroupFooter>

      {error ? (
        <p className="m-0 mt-4 text-aux text-danger" data-testid="transfer-submit-error">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        <Button
          disabled={!selected || transfer.isPending}
          onClick={() => setConfirming(true)}
          data-testid="btn-start-transfer"
        >
          转让给 ta
        </Button>
      </div>

      {confirming && selected ? (
        <ConfirmDialog
          title="确认转让管理员？"
          description={
            <>
              社群管理员将转给{' '}
              <span className="font-medium text-foreground">{selectedNickname}</span>。
              你会立刻变成普通成员，这一步不能撤销（只能由新管理员再转回来）。
            </>
          }
          confirmLabel="确认转让"
          busy={transfer.isPending}
          testId="transfer-confirm-dialog"
          confirmTestId="btn-confirm-transfer"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            transfer.mutate(
              { targetUserId: selected },
              {
                onSuccess: () => {
                  setConfirming(false)
                  toast(`管理员已转让给 ${selectedNickname}`)
                  navigate(`/c/${encodeURIComponent(name ?? '')}`)
                },
                onError: (err) => {
                  setConfirming(false)
                  setError(authErrorMessage(err))
                },
              },
            )
          }}
        />
      ) : null}
    </>
  )
}
