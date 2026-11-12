import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCommunityDetail, useMembership, useMyCommunities } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 社群页。
 *
 * **P2.1 阶段是单栏骨架**：社群概览 + 帖子列表占位。
 * P2.4 会把它改成双栏（左列表 + 右正文），届时这里的概览会挪进右栏的空态，
 * 帖子列表挪进左栏——所以概览部分现在就要写成独立组件，避免 P2.4 重写。
 *
 * 路由参数是**社群名**（不是 id）：名称本身就是标识。
 */
export function CommunityPage() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  // 公开详情里没有"我加没加入"（放行 = 匿名），所以从 /mine 推导。
  // /mine 已经缓存，按钮不会先渲染成"加入"再闪成"已加入"。
  const mine = useMyCommunities(authed)
  const { join, leave } = useMembership()
  const [actionError, setActionError] = useState<string | null>(null)

  const joined = (mine.data?.items ?? []).some((c) => c.name === detail.data?.name)
  const busy = join.isPending || leave.isPending

  if (detail.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <p className="text-sm text-danger" data-testid="community-error">
            {authErrorMessage(detail.error)}
          </p>
          <Link to="/" className="mt-3 inline-block text-[11px] text-muted-foreground underline">
            返回社群列表
          </Link>
        </Card>
      </div>
    )
  }

  const community = detail.data

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="community-page">
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle data-testid="community-name">{community.name}</CardTitle>
          <span className="text-[11px] text-muted-foreground">
            {community.memberCount} 成员
          </span>
        </div>
        {community.description ? (
          <CardDescription className="whitespace-pre-wrap" data-testid="community-desc">
            {community.description}
          </CardDescription>
        ) : (
          <CardDescription>这个社群还没有简介</CardDescription>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {authed && joined ? (
            <Link
              to={`/c/${encodeURIComponent(name ?? '')}/new`}
              className="text-[11px] underline"
              data-testid="link-new-post"
            >
              发帖
            </Link>
          ) : null}
          {!authed ? (
            <a
              href={`/login?redirect=${encodeURIComponent(`/c/${name ?? ''}`)}`}
              className="text-[11px] text-muted-foreground underline"
              data-testid="link-login-to-join"
            >
              登录后可以加入社群
            </a>
          ) : joined ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setActionError(null)
                leave.mutate(community.name ?? '', {
                  onError: (err) => setActionError(authErrorMessage(err)),
                })
              }}
              data-testid="btn-leave-community"
            >
              {busy ? '处理中…' : '退出社群'}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setActionError(null)
                join.mutate(community.name ?? '', {
                  onError: (err) => setActionError(authErrorMessage(err)),
                })
              }}
              data-testid="btn-join-community"
            >
              {busy ? '处理中…' : '加入社群'}
            </Button>
          )}
        </div>
        {actionError ? (
          <p className="text-[11px] text-danger" data-testid="membership-error">
            {actionError}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <CardTitle>帖子</CardTitle>
        <CardDescription>帖子列表在 P2.4 实现（双栏布局同时落地）</CardDescription>
      </Card>
    </div>
  )
}
