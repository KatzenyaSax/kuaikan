import { useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  Crown,
  History,
  LogIn,
  LogOut,
  Megaphone,
  PenLine,
  Settings,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react'
import { useSession } from '@/features/auth/session'
import {
  useCommunityDetail,
  useMembership,
  useMyCommunityStatus,
} from '@/features/community/api'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { ApiError } from '@/shared/api/api-error'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { absoluteDate, absoluteDateTime } from '@/shared/lib/time'

export function CommunityOverview() {
  const { name } = useParams()
  const communityName = name ?? ''
  const status = useSession((s) => s.status)
  const isAuth = status === 'authenticated'

  const detail = useCommunityDetail(communityName)
  const myStatus = useMyCommunityStatus(communityName, isAuth)
  const membership = useMembership()
  const [memError, setMemError] = useState<string | null>(null)

  const ownerId = detail.data?.ownerId
  const { data: ownerSummaries } = useUserSummaries([ownerId])
  const owner = pickAuthor(ownerSummaries, ownerId)
  const chroma = getCommunityChroma(detail.data?.name ?? communityName)

  if (detail.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full rounded-3xl" />
        <Skeleton className="h-28 w-full rounded-3xl" />
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <Empty
        testId="community-error"
        title="社群不存在或暂时无法加载"
        description={
          detail.error instanceof ApiError
            ? detail.error.message
            : '请检查社群名称是否正确，或返回首页浏览全部社群。'
        }
        action={
          <Link
            to="/"
            className="btn-aurora inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold"
          >
            返回发现画廊
          </Link>
        }
      />
    )
  }

  const c = detail.data
  const joined = Boolean(myStatus.data?.joined)
  const isAdmin = Boolean(myStatus.data?.admin)
  const isBanned = Boolean(myStatus.data?.banned)
  const memPending = membership.join.isPending || membership.leave.isPending

  const handleToggleMembership = (join: boolean) => {
    setMemError(null)
    const mutation = join ? membership.join : membership.leave
    mutation.mutate(c.name ?? communityName, {
      onError: (err) => {
        setMemError(err instanceof ApiError ? err.message : '操作失败，请稍后再试')
      },
    })
  }

  return (
    <div data-testid="community-page" className="space-y-5">
      {/* 社群极光主视觉 Hero 卡 */}
      <Card padding="none" className="overflow-hidden rounded-3xl">
        {/* 顶部全息流光横幅 */}
        <div
          className="relative h-28 w-full sm:h-32"
          style={{ background: chroma.gradient }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 80% 25%, rgba(255,255,255,0.34), transparent 55%)',
            }}
          />
        </div>

        <div className="px-6 pt-4 pb-6">
          {/* 头像 + 快捷按钮栏（仅头像上跨横幅，标题与按钮稳落卡片正面） */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="-mt-14 shrink-0 rounded-3xl bg-[var(--bg-canvas)] p-1.5 shadow-xl ring-1 ring-[var(--border-glass-strong)]">
                <Avatar
                  name={c.name ?? communityName}
                  src={c.avatarUrl}
                  size="xl"
                  shape="rounded"
                />
              </div>
              <div className="min-w-0 pb-0.5">
                <h1
                  data-testid="community-name"
                  className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl"
                >
                  {c.name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="tabular-nums inline-flex items-center gap-1 font-semibold text-secondary-foreground">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    {String(c.memberCount ?? 0)} 位成员
                  </span>
                  {c.createdAt && <span>· 建于 {absoluteDate(c.createdAt)}</span>}
                </div>
              </div>
            </div>

            {/* 核心操作簇 */}
            <div className="flex flex-wrap items-center gap-2">
              {!isAuth ? (
                <Link
                  to={`/login?returnTo=${encodeURIComponent(`/c/${c.name ?? communityName}`)}`}
                  data-testid="link-login-to-join"
                  className="btn-aurora inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold"
                >
                  <LogIn className="h-4 w-4" />
                  登录加入
                </Link>
              ) : joined ? (
                <>
                  {!isBanned && (
                    <Link
                      to={`/c/${encodeURIComponent(c.name ?? communityName)}/new`}
                      data-testid="link-new-post"
                      className="btn-aurora inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold"
                    >
                      <PenLine className="h-4 w-4" />
                      发布新帖
                    </Link>
                  )}
                  {!isAdmin && (
                    <Button
                      variant="secondary"
                      data-testid="btn-leave-community"
                      disabled={memPending}
                      onClick={() => handleToggleMembership(false)}
                    >
                      <LogOut className="h-4 w-4" />
                      退出社群
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  data-testid="btn-join-community"
                  disabled={memPending}
                  onClick={() => handleToggleMembership(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  {memPending ? '加入中…' : '加入社群'}
                </Button>
              )}

              <Link
                to={`/c/${encodeURIComponent(c.name ?? communityName)}/history`}
                data-testid="community-history-link"
                className="glass-panel inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-secondary-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground"
              >
                <History className="h-3.5 w-3.5 text-primary" />
                社群历史
              </Link>

              {isAdmin && (
                <Link
                  to={`/c/${encodeURIComponent(c.name ?? communityName)}/manage`}
                  data-testid="community-manage-link"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-warning/40 bg-[var(--color-warning-soft)] px-3.5 text-xs font-semibold text-warning transition-all hover:bg-warning hover:text-white"
                >
                  <Settings className="h-3.5 w-3.5" />
                  管理社群
                </Link>
              )}
            </div>
          </div>

          {/* 简介 */}
          <p
            data-testid="community-desc"
            className="mt-5 text-sm leading-relaxed text-secondary-foreground"
          >
            {c.description || '欢迎来到本讨论社群！点击左侧任一帖子开始阅读，或加入社群发布你的观点。'}
          </p>

          {/* 当前管理员卡片 */}
          {ownerId && (
            <div
              data-testid="community-admin"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-3"
            >
              <div className="flex items-center gap-2.5">
                <Pill tone="warning">
                  <Crown className="h-3 w-3" />
                  当前管理员
                </Pill>
                <Link
                  to={`/u/${encodeURIComponent(ownerId)}`}
                  data-testid="community-admin-link"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
                >
                  <Avatar
                    name={owner?.nickname ?? '管理员'}
                    src={owner?.avatarUrl}
                    size="xs"
                  />
                  <span>{owner?.nickname ?? `用户 #${ownerId.slice(-4)}`}</span>
                </Link>
              </div>
            </div>
          )}

          {/* 成员操作错误提示 */}
          {memError && (
            <p
              data-testid="membership-error"
              className="mt-4 rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger"
            >
              {memError}
            </p>
          )}
        </div>
      </Card>

      {/* 封禁状态警示横幅 */}
      {isBanned && (
        <div
          data-testid="community-banned-banner"
          className="flex items-start gap-3 rounded-3xl border border-danger/45 bg-[var(--color-danger-soft)] p-5 text-danger backdrop-blur-xl"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-bold">你当前已被该社群封禁，无法发帖、评论或重新加入</p>
            {myStatus.data?.banReason && (
              <p className="text-xs opacity-90">封禁原因：{myStatus.data.banReason}</p>
            )}
            <p className="text-xs opacity-85">
              {myStatus.data?.bannedUntil
                ? `解封时间：${absoluteDateTime(myStatus.data.bannedUntil)}`
                : '封禁时长：永久封禁'}
            </p>
          </div>
        </div>
      )}

      {/* 社群公告琉璃卡片 */}
      {c.announcement && (
        <Card
          padding="md"
          data-testid="community-announcement"
          className="rounded-3xl border-[rgba(var(--accent-rgb),0.32)]"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow"
              style={{ background: chroma.gradient }}
            >
              <Megaphone className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="font-display text-xs font-bold tracking-wider text-primary uppercase">
                社群公告
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {c.announcement}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
