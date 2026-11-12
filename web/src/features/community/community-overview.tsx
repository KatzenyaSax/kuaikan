import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCommunityDetail, useMembership, useMyCommunities } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 社群概览。两个用处：
 *   1. 双栏布局的右栏**空态**（`/c/:name` 还没选帖子时）
 *   2. （无独立页面，只作为右栏空态）
 *
 * 空态放社群概览而不是"请从左边选一个帖子"：用户进来先要知道
 * 这是个什么社群，而不是被要求做一件他还没理解的事。
 *
 * "我加没加入"从 /mine 推导——公开详情里没有 viewer 字段（放行 = 匿名）。
 */
export function CommunityOverview() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)
  const { join, leave } = useMembership()
  const [actionError, setActionError] = useState<string | null>(null)

  const joined = (mine.data?.items ?? []).some((c) => c.name === detail.data?.name)
  const busy = join.isPending || leave.isPending

  if (detail.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="p-4">
        <Card>
          <p className="text-sm text-danger" data-testid="community-error">
            {authErrorMessage(detail.error)}
          </p>
          <Link to="/" className="mt-3 inline-block text-[11px] underline">
            返回社群列表
          </Link>
        </Card>
      </div>
    )
  }

  const community = detail.data

  return (
    <div className="space-y-4 p-4" data-testid="community-page">
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle data-testid="community-name">{community.name}</CardTitle>
          <span className="text-[11px] text-muted-foreground">{community.memberCount} 成员</span>
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

      <p className="text-[11px] text-muted-foreground">从左边选一篇帖子开始读，或点「发帖」。</p>
    </div>
  )
}
