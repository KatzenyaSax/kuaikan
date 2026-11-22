import { useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import { useCommunityDetail, useMembership, useMyCommunities } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button, buttonClass } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'

/** hero 渐显的错开。80ms 一档，再多就会让人等 */
const heroDelay = (ms: number): CSSProperties => ({ '--hero-delay': `${ms}ms` }) as CSSProperties

/**
 * 社群概览 = 双栏布局的右栏**空态**（`/c/:name` 还没选帖子时）。
 *
 * 空态放社群概览而不是"请从左边选一个帖子"：用户进来先要知道这是个什么社群，
 * 而不是被要求做一件他还没理解的事。
 *
 * "我加没加入"从 /mine 推导 —— 公开详情里没有 viewer 字段（放行 = 匿名）。
 *
 * 排版是**营销页风**（与首页 hero 同一套语言）：大号社群名（display 档）、
 * 一行成员数、一段简介、两个胶囊按钮。**不用卡片**，靠留白分区。
 * 右栏是白底，左栏是浅底 —— 两栏靠底色分开，不需要一条竖线再强调一次。
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
      <div className="px-8 pb-24 pt-12 md:px-10">
        <div className="mx-auto max-w-[34rem]">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="mt-6 h-9 w-52" />
          <Skeleton className="mt-4 h-4 w-24" />
          <Skeleton className="mt-8 h-20 w-full" />
        </div>
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="px-8 pb-24 pt-12 md:px-10">
        <p className="m-0 text-body text-danger" data-testid="community-error">
          {authErrorMessage(detail.error)}
        </p>
        <Link to="/" className="mt-3 inline-block text-aux text-primary hover:underline">
          返回首页
        </Link>
      </div>
    )
  }

  const community = detail.data

  return (
    <div className="px-8 pb-24 pt-12 md:px-10" data-testid="community-page">
      <div className="mx-auto max-w-[34rem]">
        <div className="hero-in" style={heroDelay(0)}>
          <Avatar name={community.name ?? ''} url={null} size={60} />
        </div>

        <h1
          className="hero-in m-0 mt-6 text-display [overflow-wrap:anywhere]"
          style={heroDelay(40)}
          data-testid="community-name"
        >
          {community.name}
        </h1>

        <p className="hero-in m-0 mt-3 text-aux text-faint" style={heroDelay(80)}>
          {community.memberCount} 成员
        </p>

        <div className="hero-in mt-7" style={heroDelay(120)}>
          {community.description ? (
            <p
              className="m-0 whitespace-pre-wrap text-read leading-[1.8]"
              data-testid="community-desc"
            >
              {community.description}
            </p>
          ) : (
            <p className="m-0 text-body text-faint">这个社群还没有简介</p>
          )}
        </div>

        <div
          className="hero-in mt-9 flex flex-wrap items-center gap-x-7 gap-y-3"
          style={heroDelay(160)}
        >
          {!authed ? (
            <a
              href={`/login?returnTo=${encodeURIComponent(`/c/${name ?? ''}`)}`}
              className={buttonClass({ size: 'lg' })}
              data-testid="link-login-to-join"
            >
              登录后可以加入社群
            </a>
          ) : joined ? (
            <>
              {/* 发帖是这个页面唯一的主操作 —— 每屏最多一个 primary */}
              <Link
                to={`/c/${encodeURIComponent(name ?? '')}/new`}
                className={buttonClass({ size: 'lg' })}
                data-testid="link-new-post"
              >
                发帖
              </Link>
              {/* 退出是第三级操作：不被强调，但也不藏起来 */}
              <Button
                variant="link"
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
              size="lg"
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
          <p className="mt-4 text-aux text-danger" data-testid="membership-error">
            {actionError}
          </p>
        ) : null}

        <p className="mt-14 border-t border-border pt-6 text-aux text-muted-foreground">
          从左边选一篇帖子开始读。
        </p>
      </div>
    </div>
  )
}
