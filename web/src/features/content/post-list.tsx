import { Link, useParams } from 'react-router'
import { Clock, MessageSquareText } from 'lucide-react'
import { pickAuthor, usePostList, useUserSummaries } from '@/features/content/api'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

export function PostList({
  communityId,
  communityName,
}: {
  communityId: string | undefined
  communityName: string
}) {
  const { postId: activePostId } = useParams()
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    usePostList(communityId)

  const items = data?.pages.flatMap((p) => p.items ?? []) ?? []
  const { data: authors, isPending: authorsPending } = useUserSummaries(items.map((p) => p.authorId))

  if (isPending) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Empty
        testId="post-list-error"
        title="帖子列表加载失败"
        description="请稍后重试。"
        action={
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            重新加载
          </Button>
        }
      />
    )
  }

  if (items.length === 0) {
    return (
      <Empty
        testId="post-list-empty"
        title="还没有帖子"
        description="加入社群后发布第一篇讨论帖吧。"
        icon={<MessageSquareText className="h-5 w-5" />}
      />
    )
  }

  return (
    <div data-testid="post-list" className="space-y-2">
      {items.map((post) => {
        const author = pickAuthor(authors, post.authorId)
        const nick = author?.nickname ?? (authorsPending ? '…' : '已注销用户')
        const isActive = Boolean(activePostId && activePostId === post.id)
        const href = `/c/${encodeURIComponent(communityName)}/p/${encodeURIComponent(post.id ?? '')}`

        return (
          <Link
            key={post.id}
            to={href}
            data-testid="post-list-item"
            className={cn(
              'group relative block overflow-hidden rounded-2xl border p-3.5 transition-all duration-200',
              isActive
                ? 'border-[rgba(var(--accent-rgb),0.55)] bg-[var(--color-primary-soft)] shadow-md'
                : 'border-[var(--border-glass)] bg-[var(--bg-surface)] hover:border-[rgba(var(--accent-rgb),0.35)] hover:bg-[var(--bg-surface-hover)]',
            )}
          >
            {isActive && (
              <span
                className="absolute inset-y-2 left-0 w-1 rounded-r-full"
                style={{ background: 'var(--accent-gradient)' }}
              />
            )}
            <h3
              data-testid="post-list-title"
              className={cn(
                'line-clamp-2 font-display text-sm font-bold leading-snug transition-colors',
                isActive ? 'text-foreground' : 'text-foreground group-hover:text-primary',
              )}
            >
              {post.title}
            </h3>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Avatar name={nick} src={author?.avatarUrl} size="xs" />
                <span className="truncate">{nick}</span>
              </span>
              <span className="tabular-nums inline-flex shrink-0 items-center gap-1">
                <Clock className="h-3 w-3 opacity-70" />
                {relativeTime(post.createdAt)}
              </span>
            </div>
          </Link>
        )
      })}

      {hasNextPage && (
        <div className="pt-2 text-center">
          <Button
            variant="secondary"
            size="sm"
            data-testid="btn-load-more"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            className="w-full"
          >
            {isFetchingNextPage ? '加载中…' : '加载更多帖子'}
          </Button>
        </div>
      )}
    </div>
  )
}
