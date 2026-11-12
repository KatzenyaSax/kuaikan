import { Link, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { pickAuthor, usePostDetail, useUserSummaries } from '@/features/content/api'
import { PostContent } from '@/features/content/post-content'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Avatar } from '@/shared/ui/avatar'
import { Card } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 帖子详情（**单栏**）。
 *
 * P2.4 会把它改成双栏：左边帖列表、右边这个正文。届时
 * `<PostContent/>` 原样复用，只有外层布局变化。
 *
 * 作者昵称头像来自批量摘要接口（ADR 0009），不是帖子数据的一部分。
 */
export function PostPage() {
  const { name, postId } = useParams<{ name: string; postId: string }>()
  const post = usePostDetail(postId)
  const community = useCommunityDetail(name)
  // 单个作者也走批量接口：列表页会有多个作者，接口只有一个，
  // 不要为"单个"再造一条只有自己用的路径
  const authors = useUserSummaries([post.data?.authorId])
  const author = pickAuthor(authors.data, post.data?.authorId)

  if (post.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (post.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <p className="text-sm text-danger" data-testid="post-error">
            {authErrorMessage(post.error)}
          </p>
          <Link
            to={`/c/${encodeURIComponent(name ?? '')}`}
            className="mt-3 inline-block text-[11px] underline"
          >
            返回社群
          </Link>
        </Card>
      </div>
    )
  }

  const data = post.data

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="post-page">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link to={`/c/${encodeURIComponent(name ?? '')}`} className="underline">
          {community.data?.name ?? name}
        </Link>
        <span>·</span>
        <span data-testid="post-time">{data.createdAt}</span>
      </div>

      <div className="flex items-center gap-2" data-testid="post-author">
        {author ? (
          <>
            <Avatar url={author.avatarUrl ?? null} name={author.nickname ?? ''} size={24} />
            <span className="text-[11px]">{author.nickname}</span>
          </>
        ) : authors.isPending ? (
          // 作者摘要没回来时不要渲染"已注销用户"——那会闪一下又变，
          // 比留白更像 bug
          <span className="text-[11px] text-muted-foreground">加载作者…</span>
        ) : (
          // 真的查不到（账号已删）才降级
          <span className="text-[11px] text-muted-foreground" data-testid="post-author-deleted">
            已注销用户
          </span>
        )}
      </div>

      <Card>
        <PostContent post={data} />
      </Card>
    </div>
  )
}
