import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { usePostList, useUserSummaries, pickAuthor } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Avatar } from '@/shared/ui/avatar'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 左栏帖子列表。游标分页，最新在上。
 *
 * 加载更多用 IntersectionObserver 盯住底部哨兵：
 * 滚到底自动拉下一页。同时保留一个显式按钮兜底 ——
 * 观察器在"容器高度为 0""列表不足一屏"等情况下不会触发，
 * 那时没有按钮就彻底没入口了。
 *
 * 列表项用 <Link> 而不是 onClick：要支持 cmd+click 开新标签，
 * 而且 URL 才是状态（每个帖子都是真实路由）。
 */
export function PostList({ communityId }: { communityId: string | undefined }) {
  const { name } = useParams<{ name: string }>()
  const sentinel = useRef<HTMLDivElement | null>(null)
  const query = usePostList(communityId)

  // 把所有页摊平成一个列表。这是 useInfiniteQuery 存在的理由：
  // 手写"每页一个 query"时 data 只有最后一页，加载更多会替换而不是追加。
  const items = (query.data?.pages ?? []).flatMap((page) => page.items ?? [])

  const authors = useUserSummaries(items.map((p) => p.authorId))

  // 观察器只在"还有下一页且当前不在请求中"时挂上。
  // 触发后立刻 disconnect —— 否则滚到底会连续触发多次 fetchNextPage。
  useEffect(() => {
    const el = sentinel.current
    if (!el || !query.hasNextPage || query.isFetchingNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect()
          void query.fetchNextPage()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage, query])

  if (query.isPending) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <p className="p-3 text-[11px] text-danger" data-testid="post-list-error">
        {authErrorMessage(query.error)}
      </p>
    )
  }

  if (items.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground" data-testid="post-list-empty">
        还没有帖子
      </p>
    )
  }

  return (
    <div data-testid="post-list">
      <ul className="divide-y divide-border">
        {items.map((post) => {
          const author = pickAuthor(authors.data, post.authorId)
          return (
            <li key={post.id}>
              <Link
                to={`/c/${encodeURIComponent(name ?? '')}/p/${post.id ?? ''}`}
                className="block px-3 py-2 hover:bg-muted/50"
                data-testid="post-list-item"
              >
                <div className="truncate text-sm" data-testid="post-list-title">
                  {post.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {author ? (
                    <>
                      <Avatar url={author.avatarUrl ?? null} name={author.nickname ?? ''} size={14} />
                      <span className="truncate">{author.nickname}</span>
                    </>
                  ) : (
                    <span>…</span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      <div ref={sentinel} className="h-1" />

      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="w-full py-2 text-[11px] text-muted-foreground hover:underline"
          data-testid="btn-load-more"
        >
          {query.isFetchingNextPage ? '加载中…' : '加载更多'}
        </button>
      ) : (
        <p className="py-2 text-center text-[11px] text-muted-foreground">没有更多了</p>
      )}
    </div>
  )
}
