import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCommunityDetail, useMembership, useMyCommunities } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'

/**
 * 社群概览 = 双栏布局的右栏**空态**（`/c/:name` 还没选帖子时）。
 *
 * 空态放社群概览而不是"请从左边选一个帖子"：用户进来先要知道这是个什么社群，
 * 而不是被要求做一件他还没理解的事。
 *
 * "我加没加入"从 /mine 推导 —— 公开详情里没有 viewer 字段（放行 = 匿名）。
 *
 * 排版：标题 → 成员数 → 简介 → 操作。**不用卡片**，靠留白和 hairline 分区。
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
      <div className="px-6 pt-10 md:px-11">
        <Skeleton className="mb-3 h-6 w-40" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-20 w-full" />
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="px-6 pt-10 md:px-11">
        <p className="text-body text-danger" data-testid="community-error">
          {authErrorMessage(detail.error)}
        </p>
        <Link to="/" className="mt-3 inline-block text-aux underline">
          返回首页
        </Link>
      </div>
    )
  }

  const community = detail.data

  return (
    <div className="px-6 pb-24 pt-10 md:px-11" data-testid="community-page">
      <div className="mx-auto max-w-[40rem]">
      <div className="flex items-center gap-3">
        <Avatar name={community.name ?? ''} url={null} size={44} />
        <div className="min-w-0">
          <h1 className="m-0 text-title font-[640] leading-tight" data-testid="community-name">
            {community.name}
          </h1>
          <p className="m-0 mt-1 text-aux text-faint">{community.memberCount} 成员</p>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        {community.description ? (
          <p
            className="m-0 whitespace-pre-wrap text-read leading-[1.8] text-[#1a1a1a]"
            data-testid="community-desc"
          >
            {community.description}
          </p>
        ) : (
          <p className="m-0 text-body text-faint">这个社群还没有简介</p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {!authed ? (
          <a
            href={`/login?returnTo=${encodeURIComponent(`/c/${name ?? ''}`)}`}
            className="text-aux text-muted-foreground underline"
            data-testid="link-login-to-join"
          >
            登录后可以加入社群
          </a>
        ) : joined ? (
          <>
            <Link
              to={`/c/${encodeURIComponent(name ?? '')}/new`}
              className="text-aux text-primary hover:underline"
              data-testid="link-new-post"
            >
              发帖
            </Link>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setActionError(null)
                leave.mutate(community.name ?? '', {
                  onSuccess: () => toast('已退出社群'),
                  onError: (err) => setActionError(authErrorMessage(err)),
                })
              }}
              data-testid="btn-leave-community"
            >
              {busy ? '处理中…' : '退出社群'}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setActionError(null)
              join.mutate(community.name ?? '', {
                onSuccess: () => toast('已加入社群'),
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
        <p className="mt-3 text-aux text-danger" data-testid="membership-error">
          {actionError}
        </p>
      ) : null}

      <p className="mt-8 border-t border-border pt-6 text-aux text-muted-foreground">
        从左边选一篇帖子开始读。
      </p>
      </div>
    </div>
  )
}
