import { lazy, Suspense, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Check, Share2, Sparkles } from 'lucide-react'
import { useAiStore } from '@/features/ai/ai-store'
import { useSession } from '@/features/auth/session'
import { useCommunityDetail, useMyCommunityStatus } from '@/features/community/api'
import { BanMemberDialog } from '@/features/community/ban-member-dialog'
import { ConfirmDialog } from '@/features/community/dialog'
import {
  pickAuthor,
  useDeletePost,
  usePostDetail,
  useUserSummaries,
} from '@/features/content/api'
import { CommentSection } from '@/features/content/comment-section'
import { PostContent } from '@/features/content/post-content'
import { useInteractionStates } from '@/features/interaction/api'
import { FavoriteButton, LikeButton } from '@/features/interaction/interaction-buttons'
import { useFollowStates } from '@/features/social/api'
import { ApiError } from '@/shared/api/api-error'
import { api } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Skeleton } from '@/shared/ui/skeleton'

const RelatedPosts = lazy(() =>
  import('@/features/search/related-posts').then((m) => ({ default: m.RelatedPosts })),
)

export function PostPage() {
  const { name, postId } = useParams()
  const communityName = name ?? ''
  const navigate = useNavigate()

  const status = useSession((s) => s.status)
  const meId = useSession((s) => s.user?.userId)
  const isAuth = status === 'authenticated'

  const postQuery = usePostDetail(postId)
  const communityQuery = useCommunityDetail(communityName)
  const myStatusQuery = useMyCommunityStatus(communityName, isAuth)
  const deletePost = useDeletePost(postId)

  const [shareCopied, setShareCopied] = useState(false)
  const [extraShareDelta, setExtraShareDelta] = useState(0)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [banDialogOpen, setBanDialogOpen] = useState(false)

  const post = postQuery.data
  const { data: users } = useUserSummaries([post?.authorId])
  const author = pickAuthor(users, post?.authorId)

  const { data: followStates } = useFollowStates([post?.authorId], isAuth)
  const followState = post?.authorId ? followStates?.[post.authorId] : undefined

  const { data: interactionStates } = useInteractionStates(
    postId ? [`POST:${postId}`] : [],
    isAuth,
  )
  const postState = interactionStates?.find(
    (s) => s.targetType === 'POST' && s.targetId === postId,
  )

  if (postQuery.isPending) {
    return (
      <Card padding="lg" className="space-y-4 rounded-3xl">
        <Skeleton className="h-9 w-3/4 rounded-xl" />
        <Skeleton className="h-5 w-48 rounded-lg" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </Card>
    )
  }

  if (postQuery.isError || !post || !postId) {
    return (
      <Empty
        testId="post-error"
        title="帖子不存在或已被删除"
        description={
          postQuery.error instanceof ApiError
            ? postQuery.error.message
            : '这篇帖子可能已被作者或管理员移除。'
        }
      />
    )
  }

  const isAuthor = Boolean(meId && meId === post.authorId)
  const isCommunityAdmin = Boolean(myStatusQuery.data?.admin)
  const resolvedCommunityName = communityQuery.data?.name ?? communityName

  const handleShare = async () => {
    try {
      await api.post<void>(`/api/content/posts/${encodeURIComponent(postId)}/share`)
      setExtraShareDelta((n) => n + 1)
    } catch {
      // ignore
    }
    try {
      await navigator.clipboard.writeText(window.location.href)
    } catch {
      // ignore clipboard errors
    }
    setShareCopied(true)
    window.setTimeout(() => setShareCopied(false), 2000)
  }

  const handleConfirmDelete = () => {
    setDeleteError(null)
    deletePost.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false)
        void navigate(`/c/${encodeURIComponent(resolvedCommunityName)}`)
      },
      onError: (err) => {
        setDeleteError(err instanceof ApiError ? err.message : '删除帖子失败')
      },
    })
  }

  return (
    <div data-testid="post-page" className="space-y-6">
      <Card padding="lg" className="rounded-3xl">
        <PostContent
          post={post}
          author={author}
          followState={followState}
          isAuthor={isAuthor}
          isCommunityAdmin={isCommunityAdmin}
          onDeletePost={() => {
            setDeleteError(null)
            setDeleteDialogOpen(true)
          }}
          onBanAuthor={
            isCommunityAdmin && !isAuthor && post.authorId
              ? () => setBanDialogOpen(true)
              : undefined
          }
        />

        {/* 底部发光互动操作坞 */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-glass)] pt-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <LikeButton
              targetType="POST"
              targetId={postId}
              liked={Boolean(postState?.liked)}
              count={post.likeCount ?? 0}
            />
            <FavoriteButton
              targetId={postId}
              favorited={Boolean(postState?.favorited)}
              count={post.favoriteCount ?? 0}
            />
            <Button
              variant="secondary"
              data-testid="btn-share"
              onClick={() => void handleShare()}
              className="h-10 rounded-xl px-4"
            >
              {shareCopied ? (
                <>
                  <Check className="h-4 w-4 text-success" />
                  <span className="text-success">已复制链接</span>
                </>
              ) : (
                <>
                  <Share2 className="h-4 w-4 text-primary" />
                  <span className="tabular-nums">
                    分享 {String((post.shareCount ?? 0) + extraShareDelta)}
                  </span>
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              data-testid="btn-ai-summarize"
              onClick={() => {
                if (!isAuth) {
                  void navigate(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`)
                  return
                }
                useAiStore.getState().openDrawer({
                  intent: 'SUMMARIZE_POST',
                  prompt: '请帮我省流总结这篇帖子和热门评论。',
                  pageContext: {
                    type: 'POST',
                    postId,
                    communityName: resolvedCommunityName,
                  },
                })
              }}
              className="h-10 rounded-xl px-4"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span>AI 总结</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* P9.1 跨社群相关帖子（懒加载，无结果或降级静默隐藏） */}
      <Suspense fallback={null}>
        <RelatedPosts postId={postId} />
      </Suspense>

      {/* 两级评论区 */}
      <CommentSection
        postId={postId}
        postAuthorId={post.authorId}
        communityName={resolvedCommunityName}
        commentCount={post.commentCount ?? 0}
        isCommunityAdmin={isCommunityAdmin}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title={isCommunityAdmin && !isAuthor ? '以管理员身份删除该帖子？' : '确认删除这篇帖子？'}
        description="删除后帖子将从列表和搜索索引中移除，无法恢复。"
        confirmLabel="确认删除"
        danger
        pending={deletePost.isPending}
        error={deleteError}
        testId="admin-delete-post-dialog"
        confirmTestId="btn-confirm-delete-post"
      />

      {/* 封禁作者弹窗 */}
      {post.authorId && (
        <BanMemberDialog
          open={banDialogOpen}
          onClose={() => setBanDialogOpen(false)}
          communityName={resolvedCommunityName}
          targetUserId={post.authorId}
          targetNickname={author?.nickname ?? `用户 #${post.authorId.slice(-4)}`}
        />
      )}
    </div>
  )
}
