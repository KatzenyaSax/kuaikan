import { Link } from 'react-router'
import type { PostSummary } from '@/features/content/api'
import { Pill } from '@/shared/ui/pill'
import { relativeTime } from '@/shared/lib/time'

/**
 * 帖子列表行（用户主页「帖子」Tab 与 `/following` 右栏共用）。
 *
 * 与左栏的 `PostList` 不同：那里是**导航**（当前帖子高亮、双栏常驻），
 * 这里是**内容列表**（占据整栏宽度、按行分隔）。共用一份反而会让两处都别扭。
 *
 * 社群名缺席时**不渲染链接**而不是拼一个 `/c//p/xxx`：
 * 社群名要靠社群列表映射（ADR 0005：前端聚合，后端不拼），
 * 映射不到（社群在列表首页之外）时给一段不能点的纯文本，
 * 比让人点进 404 更诚实。
 */
export function PostFeedRow({
  post,
  communityName,
  authorName,
  testId = 'post-feed-item',
}: {
  post: PostSummary
  communityName: string | undefined
  /** 作者昵称；用户主页上它和页面主人是同一个人时可以不传 */
  authorName?: string | undefined
  testId?: string
}) {
  const body = (
    <>
      <p className="m-0 line-clamp-2 text-body font-medium leading-[1.5] text-foreground group-hover:text-primary">
        {post.title ?? '（无标题）'}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-caption text-faint">
        {communityName ? <Pill>{communityName}</Pill> : null}
        {authorName ? <span>{authorName}</span> : null}
        {authorName ? <span>·</span> : null}
        <span>{relativeTime(post.createdAt)}</span>
      </div>
    </>
  )

  return communityName ? (
    <Link
      to={`/c/${encodeURIComponent(communityName)}/p/${post.id ?? ''}`}
      className="group block"
      data-testid={testId}
    >
      {body}
    </Link>
  ) : (
    <div data-testid={testId}>{body}</div>
  )
}

/**
 * 「加载更多」。
 *
 * 用户主页与 `/following` 都是**按需展开**的列表，不做无限滚动：
 * 这两页的第一屏信息已经足够，自动加载只会让人在滚动时被更多请求牵住。
 * 没有下一页时**什么都不渲染** —— 一行"没有更多了"在这里是噪音。
 */
export function FeedLoadMore({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  testId = 'btn-load-more-feed',
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  testId?: string
}) {
  if (!hasNextPage) return null
  return (
    <button
      type="button"
      onClick={onLoadMore}
      disabled={isFetchingNextPage}
      className="w-full py-3 text-aux text-muted-foreground hover:underline disabled:opacity-50"
      data-testid={testId}
    >
      {isFetchingNextPage ? '加载中…' : '加载更多'}
    </button>
  )
}
