import { Link, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { useInteractionStates } from '@/features/interaction/api'
import { FavoriteButton, LikeButton } from '@/features/interaction/interaction-buttons'
import { pickAuthor, usePostDetail, useUserSummaries } from '@/features/content/api'
import { PostContent } from '@/features/content/post-content'
import { CommentSection } from '@/features/content/comment-section'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { toast } from '@/shared/ui/toast'

/**
 * 帖子详情（右栏）。
 *
 * 排版结构固定为：面包屑 → 标题 → 作者行（上下 hairline 夹住）→ 正文 →
 * 互动条（hairline 上方分隔）→ 评论区。
 *
 * **全页没有卡片**：分区靠 1px hairline 和留白。卡片多了立刻显廉价。
 */
export function PostPage() {
  const { name, postId } = useParams<{ name: string; postId: string }>()
  const post = usePostDetail(postId)
  const community = useCommunityDetail(name)
  // 单个作者也走批量接口：列表页会有多个作者，接口只有一个，
  // 不要为"单个"再造一条只有自己用的路径
  const authors = useUserSummaries([post.data?.authorId])
  const status = useSession((s) => s.status)
  const targets = post.data?.id ? [`post:${post.data.id}`] : []
  const states = useInteractionStates(targets, status === 'authenticated')
  const author = pickAuthor(authors.data, post.data?.authorId)

  if (post.isPending) {
    return (
      <div className="px-11 pt-10">
        <Skeleton className="mb-4 h-7 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (post.isError) {
    return (
      <div className="px-11 pt-10">
        <p className="text-body text-danger" data-testid="post-error">
          {authErrorMessage(post.error)}
        </p>
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="mt-3 inline-block text-aux text-muted-foreground underline"
        >
          返回社群
        </Link>
      </div>
    )
  }

  const data = post.data

  return (
    <div className="px-6 pb-24 pt-10 md:px-11" data-testid="post-page">
      <div className="mx-auto max-w-[40rem]">
      <div className="mb-4 flex items-center gap-2 text-aux text-faint">
        <Link to={`/c/${encodeURIComponent(name ?? '')}`} className="text-primary hover:underline">
          {community.data?.name ?? name}
        </Link>
        <span>·</span>
        <span data-testid="post-time">{relativeTime(data.createdAt)}</span>
      </div>

      <PostContent post={data} />

      {/* 作者行：上下 hairline，不用卡片 */}
      <div
        className="mt-5 flex items-center gap-2.5 border-y border-border py-3.5 text-aux text-muted-foreground"
        data-testid="post-author"
      >
        {author ? (
          <>
            <Avatar url={author.avatarUrl ?? null} name={author.nickname ?? ''} size={28} />
            <span className="font-medium text-foreground">{author.nickname}</span>
            <span className="text-faint">·</span>
            <span>{relativeTime(data.createdAt)}</span>
          </>
        ) : authors.isPending ? (
          // 作者摘要没回来时不要渲染"已注销用户"——那会闪一下又变，比留白更像 bug
          <span>加载作者…</span>
        ) : (
          <span data-testid="post-author-deleted">已注销用户</span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4.5">
        <LikeButton
          targetType="post"
          targetId={data.id ?? ''}
          count={data.likeCount ?? 0}
          states={states.data}
        />
        <FavoriteButton
          targetId={data.id ?? ''}
          count={data.favoriteCount ?? 0}
          states={states.data}
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(window.location.href)
              .then(() => toast('链接已复制'))
              .catch(() => toast('复制失败，可手动复制地址栏'))
          }}
          className="text-aux text-muted-foreground transition-colors duration-[150ms] hover:text-foreground"
        >
          分享
        </button>
      </div>

      <CommentSection postId={data.id ?? ''} commentCount={data.commentCount ?? 0} />
      </div>
    </div>
  )
}
