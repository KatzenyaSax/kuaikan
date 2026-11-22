import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { usePostList, useUserSummaries, pickAuthor } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Avatar } from '@/shared/ui/avatar'
import { Group, groupRowClass } from '@/shared/ui/group'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

/**
 * 左栏帖子列表。游标分页，最新在上。
 *
 * 加载更多用 IntersectionObserver 盯住底部哨兵：滚到底自动拉下一页。
 * 同时保留一个显式按钮兜底 —— 观察器在"容器高度为 0""列表不足一屏"等
 * 情况下不会触发，那时没有按钮就彻底没入口了。
 *
 * 列表项是真实路由（`<Link>`），所以要支持 cmd+click 开新标签；
 * 用它而不是 onClick 也顺手拿到了键盘可达性。
 *
 * 形态是 inset grouped：白色分组里的内缩 hairline 行。左栏是“导航”，
 * 不是“清单”——所以当前帖子用淡底标出来，而不是加一条左边线。
 */
export function PostList({ communityId }: { communityId: string | undefined }) {
  const { name, postId: activePostId } = useParams<{ name: string; postId?: string }>()
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
      <Group>
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-4 py-4">
            <Skeleton className="mb-2 h-[15px] w-[78%]" />
            <Skeleton className="h-3 w-[42%]" />
          </div>
        ))}
      </Group>
    )
  }

  if (query.isError) {
    return (
      <p className="px-4 py-3 text-aux text-danger" data-testid="post-list-error">
        {authErrorMessage(query.error)}
      </p>
    )
  }

  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-aux text-faint" data-testid="post-list-empty">
        还没有帖子
      </p>
    )
  }

  return (
    <div data-testid="post-list">
      <Group>
        <ul className="m-0 list-none p-0">
          {items.map((post) => {
            const author = pickAuthor(authors.data, post.authorId)
            return (
              <li
                key={post.id}
                className={groupRowClass({ interactive: true, className: 'block p-0' })}
                style={{ animation: 'fade-in var(--duration-base) var(--ease-out-soft) both' }}
              >
                <Link
                  to={`/c/${encodeURIComponent(name ?? '')}/p/${post.id ?? ''}`}
                  // 当前正在读的帖子要高亮：左栏是"导航"，不是"清单"，
                  // 不标出当前位置，用户会不知道自己在看哪一篇。
                  aria-current={activePostId === post.id ? 'true' : undefined}
                  className={cn(
                    'block px-4 py-3',
                    'transition-colors duration-[var(--duration-fast)]',
                    'aria-[current=true]:bg-fill',
                  )}
                  data-testid="post-list-item"
                >
                  <div
                    className="line-clamp-2 text-body font-medium leading-[1.45]"
                    data-testid="post-list-title"
                  >
                    {post.title}
                  </div>
                  {/* 作者 · 时间：扇视列表时人关心的是"谁写的、新不新" */}
                  <div className="mt-1 flex items-center gap-1.5 text-caption text-faint">
                    {author ? (
                      <>
                        <Avatar url={author.avatarUrl ?? null} name={author.nickname ?? ''} size={14} />
                        <span className="truncate">{author.nickname}</span>
                      </>
                    ) : (
                      <span>…</span>
                    )}
                    <span>·</span>
                    <span>{relativeTime(post.createdAt)}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </Group>

      <div ref={sentinel} className="h-1" />

      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="w-full py-3 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground disabled:opacity-50"
          data-testid="btn-load-more"
        >
          {query.isFetchingNextPage ? '加载中…' : '加载更多'}
        </button>
      ) : (
        <p className="py-3 text-center text-caption text-faint">没有更多了</p>
      )}
    </div>
  )
}
