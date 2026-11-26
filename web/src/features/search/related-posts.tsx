import { Link } from 'react-router'
import { Sparkles } from 'lucide-react'
import { useRelatedPosts } from '@/features/search/api'
import { Card } from '@/shared/ui/card'

/**
 * 帖子详情页「相关帖子」推荐（P9.1）：
 * 位于正文卡片与评论区之间，游客可读；无结果或下游降级时静默隐藏。
 */
export function RelatedPosts({ postId }: { postId: string }) {
  const { data: items, isPending, isError } = useRelatedPosts(postId)

  if (isPending || isError || !items || items.length === 0) {
    return null
  }

  return (
    <Card padding="md" data-testid="related-posts" className="rounded-3xl space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">相关帖子推荐</h2>
        <span className="text-[11px] text-muted-foreground">跨社群语义相似</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const href = item.communityName && item.postId
            ? `/c/${encodeURIComponent(item.communityName)}/p/${encodeURIComponent(item.postId)}`
            : '#'
          return (
            <Link
              key={item.postId}
              to={href}
              data-testid="related-post-item"
              className="group flex flex-col justify-between rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-2.5 transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:bg-[var(--bg-surface-hover)]"
            >
              <div className="line-clamp-2 text-sm font-medium text-foreground group-hover:text-primary">
                {item.title}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {item.communityName ? `#${item.communityName}` : ''}
                  {item.communityName && item.authorNickname ? ' · ' : ''}
                  {item.authorNickname}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
