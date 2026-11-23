import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowUpRight, Clock } from 'lucide-react'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import type { PostSummary } from '@/features/content/api'
import { useCommunityList } from '@/features/community/api'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'

export function PostFeed({
  posts,
  isPending = false,
  emptyTitle = '暂无帖子',
  emptyDescription = '这里还没有人发帖，去感兴趣的社群开启第一场讨论吧。',
  testId = 'post-feed',
  showCommunity = true,
}: {
  posts: PostSummary[]
  isPending?: boolean
  emptyTitle?: string
  emptyDescription?: string
  testId?: string
  showCommunity?: boolean
}) {
  const authorIds = posts.map((p) => p.authorId)
  const { data: users, isPending: usersPending } = useUserSummaries(authorIds)
  const { data: communitiesPage } = useCommunityList(null)

  const communityById = new Map<string, { name: string; avatarUrl?: string | null | undefined }>()
  for (const c of communitiesPage?.items ?? []) {
    if (c.id && c.name) {
      communityById.set(c.id, { name: c.name, avatarUrl: c.avatarUrl })
    }
  }

  if (isPending) {
    return (
      <div className="space-y-3" data-testid={testId}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (posts.length === 0) {
    return <Empty title={emptyTitle} description={emptyDescription} testId={testId} />
  }

  return (
    <div data-testid={testId} className="space-y-3">
      {posts.map((post, idx) => {
        const author = pickAuthor(users, post.authorId)
        const authorName = author?.nickname ?? (usersPending ? '…' : '已注销用户')
        const comm = post.communityId ? communityById.get(post.communityId) : undefined
        const commName = comm?.name
        const chroma = getCommunityChroma(commName ?? post.communityId)
        const href =
          commName && post.id
            ? `/c/${encodeURIComponent(commName)}/p/${encodeURIComponent(post.id)}`
            : null

        const inner = (
          <Card
            padding="sm"
            className="group transition-transform duration-300 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2.5">
                {/* 顶行：社群色标 + 作者 + 时间 */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {showCommunity && commName && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm"
                      style={{ background: chroma.gradient }}
                    >
                      #{commName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 font-medium text-secondary-foreground">
                    <Avatar name={authorName} src={author?.avatarUrl} size="xs" />
                    <span className="truncate max-w-[140px]">{authorName}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3 opacity-70" />
                    {relativeTime(post.createdAt)}
                  </span>
                </div>

                {/* 标题 */}
                <h3 className="font-display text-base font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {post.title}
                </h3>
              </div>

              {href && (
                <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] text-muted-foreground transition-all group-hover:border-[rgba(var(--accent-rgb),0.45)] group-hover:bg-[var(--color-primary-soft)] group-hover:text-primary">
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              )}
            </div>
          </Card>
        )

        return (
          <motion.div
            key={post.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(idx * 0.035, 0.28) }}
          >
            {href ? (
              <Link to={href} className="block">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
