import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Clock, Eye, ShieldBan, Trash2 } from 'lucide-react'
import type { PostDetail, UserSummary } from '@/features/content/api'
import { FollowButton } from '@/features/social/follow-button'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { absoluteDateTime } from '@/shared/lib/time'

export function PostContent({
  post,
  author,
  followState,
  isAuthor,
  isCommunityAdmin,
  onDeletePost,
  onBanAuthor,
}: {
  post: PostDetail
  author: UserSummary | null
  followState?: { following: boolean; followedBy: boolean } | undefined
  isAuthor: boolean
  isCommunityAdmin: boolean
  onDeletePost: () => void
  onBanAuthor?: (() => void) | undefined
}) {
  const showAdminDelete = isCommunityAdmin && !isAuthor
  const showAdminBan = isCommunityAdmin && !isAuthor && Boolean(post.authorId) && Boolean(onBanAuthor)

  return (
    <article className="space-y-6">
      {/* 标题与元信息 */}
      <header className="space-y-4 border-b border-[var(--border-glass)] pb-5">
        <h1
          data-testid="post-title"
          className="font-display text-2xl leading-tight font-extrabold tracking-tight text-foreground sm:text-3xl"
        >
          {post.title}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 作者行 */}
          <div className="flex flex-wrap items-center gap-3">
            {author && post.authorId ? (
              <Link
                to={`/u/${encodeURIComponent(post.authorId)}`}
                data-testid="post-author-link"
                className="group inline-flex items-center gap-2.5"
              >
                <Avatar name={author.nickname ?? '?'} src={author.avatarUrl} size="sm" ring />
                <div>
                  <span
                    data-testid="post-author"
                    className="block text-sm font-bold text-foreground transition-colors group-hover:text-primary"
                  >
                    {author.nickname}
                  </span>
                  <span
                    data-testid="post-time"
                    className="tabular-nums inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                  >
                    <Clock className="h-3 w-3" />
                    {absoluteDateTime(post.createdAt)}
                  </span>
                </div>
              </Link>
            ) : (
              <div className="inline-flex items-center gap-2.5">
                <Avatar name="注销" size="sm" />
                <div>
                  <span
                    data-testid="post-author-deleted"
                    className="block text-sm font-medium text-muted-foreground"
                  >
                    已注销用户
                  </span>
                  <span
                    data-testid="post-time"
                    className="tabular-nums text-[11px] text-muted-foreground"
                  >
                    {absoluteDateTime(post.createdAt)}
                  </span>
                </div>
              </div>
            )}

            {post.authorId && author && (
              <FollowButton
                targetUserId={post.authorId}
                following={Boolean(followState?.following)}
                followedBy={Boolean(followState?.followedBy)}
                size="sm"
              />
            )}
          </div>

          {/* 右侧浏览数与治理操作 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums inline-flex items-center gap-1 rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-1 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" />
              {String(post.viewCount ?? 0)} 次阅读
            </span>

            {isAuthor && (
              <Button variant="ghost" size="sm" onClick={onDeletePost} className="text-danger hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
                删除帖子
              </Button>
            )}

            {showAdminDelete && (
              <Button
                variant="danger"
                size="sm"
                data-testid="admin-delete-post"
                onClick={onDeletePost}
              >
                <Trash2 className="h-3.5 w-3.5" />
                管理员删帖
              </Button>
            )}

            {showAdminBan && (
              <Button
                variant="danger"
                size="sm"
                data-testid="admin-ban-post-author"
                onClick={onBanAuthor}
              >
                <ShieldBan className="h-3.5 w-3.5" />
                封禁作者
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Markdown 正文 */}
      <div data-testid="post-body" className="prose-aurora">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body ?? ''}</ReactMarkdown>
      </div>
    </article>
  )
}
