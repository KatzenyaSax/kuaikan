import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Crown,
  Search,
  Settings,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Users,
} from 'lucide-react'
import {
  useCommunityBans,
  useCommunityDetail,
  useCommunityMembers,
  useMyCommunityStatus,
  useTransferCommunityAdmin,
  useUnbanCommunityMember,
  useUpdateCommunityInfo,
} from '@/features/community/api'
import type { CommunityDetail } from '@/features/community/api'
import { BanMemberDialog } from '@/features/community/ban-member-dialog'
import { ConfirmDialog } from '@/features/community/dialog'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { ApiError } from '@/shared/api/api-error'
import { Avatar } from '@/shared/ui/avatar'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Field, Input, Textarea } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { absoluteDate, absoluteDateTime } from '@/shared/lib/time'

type ManageTab = 'info' | 'bans' | 'transfer'

function isValidAvatarUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s) return true
  return /^https?:\/\/.+/i.test(s)
}

export function CommunityManagePage() {
  const { name } = useParams()
  const communityName = name ?? ''
  const [tab, setTab] = useState<ManageTab>('info')

  const detail = useCommunityDetail(communityName)
  const myStatus = useMyCommunityStatus(communityName, true)

  if (detail.isPending || myStatus.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-16 w-64 rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-3xl" />
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <div data-testid="manage-error" className="mx-auto max-w-2xl py-8">
        <Empty
          title="无法加载社群管理台"
          description={detail.error instanceof ApiError ? detail.error.message : '社群不存在或请求失败。'}
          action={
            <Link
              to="/"
              className="btn-aurora inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold"
            >
              返回首页
            </Link>
          }
        />
      </div>
    )
  }

  if (!myStatus.data?.admin) {
    return (
      <div data-testid="manage-forbidden" className="mx-auto max-w-2xl py-8">
        <Empty
          title="只有社群管理员可以访问管理台"
          description="你当前不是该社群的管理员，但可以公开查阅本社群的编年史与治理记录。"
          icon={<ShieldAlert className="h-5 w-5" />}
          action={
            <Link
              to={`/c/${encodeURIComponent(communityName)}`}
              data-testid="manage-back-link"
              className="btn-aurora inline-flex h-10 items-center gap-1.5 rounded-xl px-5 text-sm font-semibold"
            >
              <ArrowLeft className="h-4 w-4" />
              返回「{detail.data.name}」
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div data-testid="community-manage-page" className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-4">
        <Link
          to={`/c/${encodeURIComponent(communityName)}`}
          data-testid="manage-back-link"
          className="glass-panel inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-primary" />
          返回「{detail.data.name}」
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <LuminousIcon
              size="lg"
              gradient="linear-gradient(135deg, #F59E0B, #FB7185)"
            >
              <Settings className="h-6 w-6" />
            </LuminousIcon>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {detail.data.name} · <span className="text-aurora">管理社群</span>
            </h1>
          </div>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'info', label: '社群信息', testId: 'manage-tab-info' },
              { value: 'bans', label: '封禁与成员', testId: 'manage-tab-bans' },
              { value: 'transfer', label: '管理员转让', testId: 'manage-tab-transfer' },
            ]}
          />
        </div>
      </div>

      {tab === 'info' && <InfoTab key={detail.data.id} community={detail.data} />}
      {tab === 'bans' && <BansAndMembersTab communityName={detail.data.name ?? communityName} />}
      {tab === 'transfer' && <TransferTab communityName={detail.data.name ?? communityName} />}
    </div>
  )
}

function InfoTab({ community }: { community: CommunityDetail }) {
  const name = community.name ?? ''
  const update = useUpdateCommunityInfo(name)

  const [description, setDescription] = useState(community.description ?? '')
  const [avatarUrl, setAvatarUrl] = useState(community.avatarUrl ?? '')
  const [announcement, setAnnouncement] = useState(community.announcement ?? '')
  const [savedNotice, setSavedNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const avatarValid = isValidAvatarUrl(avatarUrl)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSavedNotice(false)
    setError(null)
    if (!avatarValid) {
      setError('头像链接必须以 http:// 或 https:// 开头')
      return
    }
    update.mutate(
      {
        description: description.trim(),
        avatarUrl: avatarUrl.trim(),
        announcement: announcement.trim(),
      },
      {
        onSuccess: () => {
          setSavedNotice(true)
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
        },
      },
    )
  }

  return (
    <Card padding="lg" className="rounded-3xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-4 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4">
          <Avatar
            name={name}
            src={avatarValid ? avatarUrl.trim() || null : null}
            size="lg"
            shape="rounded"
            ring
          />
          <div className="min-w-0">
            <p className="font-display text-base font-bold text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground">
              社群名称不可修改；下方字段留空提交即清空对应内容
            </p>
          </div>
        </div>

        <Field
          label="社群头像链接（可选）"
          htmlFor="manage-avatar"
          hint="仅支持 http:// 或 https:// 外链，留空将使用专属极光渐变头像"
        >
          <Input
            id="manage-avatar"
            data-testid="field-community-avatar"
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value)
              setSavedNotice(false)
            }}
            placeholder="https://example.com/avatar.png"
            maxLength={512}
          />
          {!avatarValid && (
            <p data-testid="avatar-url-invalid" className="mt-1 text-xs font-medium text-danger">
              头像链接必须以 http:// 或 https:// 开头
            </p>
          )}
        </Field>

        <Field
          label="社群简介"
          htmlFor="manage-desc"
          right={
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {description.length} / 500
            </span>
          }
        >
          <Textarea
            id="manage-desc"
            data-testid="field-community-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setSavedNotice(false)
            }}
            rows={3}
            maxLength={500}
            placeholder="介绍这个社群的定位与讨论氛围…"
          />
        </Field>

        <Field
          label="社群公告"
          htmlFor="manage-announcement"
          right={
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {announcement.length} / 1000
            </span>
          }
        >
          <Textarea
            id="manage-announcement"
            data-testid="field-community-announcement"
            value={announcement}
            onChange={(e) => {
              setAnnouncement(e.target.value)
              setSavedNotice(false)
            }}
            rows={4}
            maxLength={1000}
            placeholder="发布置顶社群规范、活动预告或欢迎词…"
          />
        </Field>

        {error && (
          <p
            data-testid="manage-info-error"
            className="rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger"
          >
            {error}
          </p>
        )}

        {savedNotice && (
          <p
            data-testid="manage-info-saved"
            className="inline-flex items-center gap-1.5 rounded-xl border border-success/35 bg-[var(--color-success-soft)] px-3.5 py-2.5 text-xs font-semibold text-success"
          >
            <CheckCircle2 className="h-4 w-4" />
            社群信息已保存并记入编年史
          </p>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            data-testid="btn-save-community-info"
            disabled={update.isPending || !avatarValid}
          >
            {update.isPending ? '保存中…' : '保存变更'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function BansAndMembersTab({ communityName }: { communityName: string }) {
  const bans = useCommunityBans(communityName, true)
  const members = useCommunityMembers(communityName, true)
  const unban = useUnbanCommunityMember(communityName)

  const [filter, setFilter] = useState('')
  const [banTarget, setBanTarget] = useState<{ userId: string; nickname: string } | null>(null)

  const banItems = useMemo(() => bans.data?.pages.flatMap((p) => p.items ?? []) ?? [], [bans.data])
  const memberItems = useMemo(
    () => members.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [members.data],
  )

  const userIds = useMemo(
    () => [
      ...banItems.map((b) => b.userId),
      ...banItems.map((b) => b.bannedBy),
      ...memberItems.map((m) => m.userId),
    ],
    [banItems, memberItems],
  )
  const { data: users } = useUserSummaries(userIds)

  const filteredMembers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return memberItems
    return memberItems.filter((m) => {
      const u = pickAuthor(users, m.userId)
      return (
        (u?.nickname ?? '').toLowerCase().includes(q) ||
        (m.userId ?? '').toLowerCase().includes(q)
      )
    })
  }, [memberItems, filter, users])

  return (
    <div className="space-y-6">
      {/* 生效中的封禁名单 */}
      <Card padding="md" className="rounded-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldBan className="h-4 w-4 text-danger" />
            <h2 className="font-display text-base font-bold text-foreground">
              生效中的封禁名单 ({String(banItems.length)})
            </h2>
          </div>
        </div>

        {bans.isPending ? (
          <Skeleton className="h-20 w-full rounded-2xl" />
        ) : bans.isError ? (
          <p data-testid="ban-list-error" className="text-xs text-danger">
            封禁名单加载失败，请刷新重试。
          </p>
        ) : banItems.length === 0 ? (
          <div
            data-testid="ban-list"
            className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-6 text-center text-xs text-muted-foreground"
          >
            当前没有生效中的封禁记录，社群秩序良好。
          </div>
        ) : (
          <div data-testid="ban-list" className="space-y-2.5">
            {banItems.map((b) => {
              const u = pickAuthor(users, b.userId)
              const nick = u?.nickname ?? `用户 #${(b.userId ?? '').slice(-4)}`
              return (
                <div
                  key={b.userId}
                  data-testid="ban-item"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/25 bg-[var(--bg-input)] p-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={nick} src={u?.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{nick}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.reason ? `原因：${b.reason} · ` : ''}
                        {b.expiresAt ? `到期：${absoluteDateTime(b.expiresAt)}` : '永久封禁'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="btn-unban"
                    disabled={unban.isPending}
                    onClick={() => b.userId && unban.mutate(b.userId)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-success" />
                    解除封禁
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 在社成员名单 */}
      <Card padding="md" className="rounded-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-bold text-foreground">
              社群成员 ({String(memberItems.length)})
            </h2>
          </div>

          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="field-member-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="按昵称或 ID 筛选…"
              className="h-9 pl-8 text-xs"
            />
          </div>
        </div>

        {members.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        ) : members.isError ? (
          <p data-testid="member-list-error" className="text-xs text-danger">
            成员名单加载失败。
          </p>
        ) : (
          <div data-testid="member-list" className="space-y-2">
            {filteredMembers.map((m) => {
              const u = pickAuthor(users, m.userId)
              const nick = u?.nickname ?? `用户 #${(m.userId ?? '').slice(-4)}`
              return (
                <div
                  key={m.userId}
                  data-testid="member-item"
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={nick} src={u?.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/u/${encodeURIComponent(m.userId ?? '')}`}
                          className="truncate text-sm font-semibold text-foreground hover:text-primary"
                        >
                          {nick}
                        </Link>
                        {m.admin && (
                          <Pill tone="warning">
                            <Crown className="h-3 w-3" />
                            管理员
                          </Pill>
                        )}
                      </div>
                      <p className="tabular-nums text-[11px] text-muted-foreground">
                        加入于 {absoluteDate(m.joinedAt)}
                      </p>
                    </div>
                  </div>

                  {!m.admin && m.userId && (
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid="btn-ban-member"
                      onClick={() => setBanTarget({ userId: m.userId ?? '', nickname: nick })}
                    >
                      <ShieldBan className="h-3.5 w-3.5" />
                      封禁
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {members.hasNextPage && (
          <div className="text-center">
            <Button
              variant="secondary"
              size="sm"
              data-testid="btn-load-more-members"
              disabled={members.isFetchingNextPage}
              onClick={() => void members.fetchNextPage()}
            >
              {members.isFetchingNextPage ? '加载中…' : '加载更多成员'}
            </Button>
          </div>
        )}
      </Card>

      {banTarget && (
        <BanMemberDialog
          open={Boolean(banTarget)}
          onClose={() => setBanTarget(null)}
          communityName={communityName}
          targetUserId={banTarget.userId}
          targetNickname={banTarget.nickname}
        />
      )}
    </div>
  )
}

function TransferTab({ communityName }: { communityName: string }) {
  const navigate = useNavigate()
  const members = useCommunityMembers(communityName, true)
  const transfer = useTransferCommunityAdmin(communityName)

  const [selected, setSelected] = useState<{ userId: string; nickname: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const candidates = useMemo(
    () => (members.data?.pages.flatMap((p) => p.items ?? []) ?? []).filter((m) => !m.admin),
    [members.data],
  )
  const { data: users } = useUserSummaries(candidates.map((c) => c.userId))

  const handleConfirm = () => {
    if (!selected) return
    setSubmitError(null)
    transfer.mutate(
      { targetUserId: selected.userId },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          void navigate(`/c/${encodeURIComponent(communityName)}`)
        },
        onError: (err) => {
          setSubmitError(err instanceof ApiError ? err.message : '转让失败，请稍后重试')
        },
      },
    )
  }

  return (
    <Card padding="md" className="rounded-3xl space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-warning" />
          <h2 className="font-display text-base font-bold text-foreground">转让社群管理员</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          只能将管理员身份转让给本社群在社成员。转让立即生效，你将降为普通成员（此后可自由退出社群），本次交接将永久记入历代管理员脉络。
        </p>
      </div>

      {members.isPending ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : members.isError ? (
        <p data-testid="transfer-error" className="text-xs text-danger">
          成员名单加载失败。
        </p>
      ) : candidates.length === 0 ? (
        <Empty
          title="暂时没有可转让的候选成员"
          description="目前社群中除了你之外还没有其他在社成员。"
        />
      ) : (
        <div data-testid="transfer-candidate-list" className="space-y-2">
          {candidates.map((m) => {
            const u = pickAuthor(users, m.userId)
            const nick = u?.nickname ?? `用户 #${(m.userId ?? '').slice(-4)}`
            const active = selected?.userId === m.userId
            return (
              <div
                key={m.userId}
                data-testid="transfer-member-item"
                className={`flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition-all ${
                  active
                    ? 'border-warning/50 bg-[var(--color-warning-soft)]'
                    : 'border-[var(--border-glass)] bg-[var(--bg-input)]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={nick} src={u?.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{nick}</p>
                    <p className="tabular-nums text-[11px] text-muted-foreground">
                      加入于 {absoluteDate(m.joinedAt)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="btn-start-transfer"
                  onClick={() => {
                    setSelected({ userId: m.userId ?? '', nickname: nick })
                    setSubmitError(null)
                    setConfirmOpen(true)
                  }}
                >
                  转让给 ta
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {submitError && !confirmOpen && (
        <p data-testid="transfer-submit-error" className="text-xs font-medium text-danger">
          {submitError}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="确认转让社群管理员？"
        description={
          <>
            确定将「<strong>{communityName}</strong>」的管理员权限永久转让给{' '}
            <strong>{selected?.nickname}</strong> 吗？转让后你将立即失去管理台访问权限。
          </>
        }
        confirmLabel="确认转让"
        danger
        pending={transfer.isPending}
        error={submitError}
        testId="transfer-confirm-dialog"
        confirmTestId="btn-confirm-transfer"
      />
    </Card>
  )
}
