import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  MessageCircle,
  Send,
  ShieldBan,
  Trash2,
} from 'lucide-react'
import { useAiStore } from '@/features/ai/ai-store'

const AiComposeBar = lazy(() =>
  import('@/features/ai/ai-compose-bar').then((m) => ({ default: m.AiComposeBar })),
)
import { useSession } from '@/features/auth/session'
import { BanMemberDialog } from '@/features/community/ban-member-dialog'
import { ConfirmDialog } from '@/features/community/dialog'
import {
  collectCommentUserIds,
  pickAuthor,
  useComments,
  useCreateComment,
  useDeleteComment,
  useReplies,
  useUserSummaries,
} from '@/features/content/api'
import type { CommentSort, CommentView, UserSummary } from '@/features/content/api'
import { MentionText } from '@/features/content/mention-text'
import { useInteractionStates } from '@/features/interaction/api'
import { LikeButton } from '@/features/interaction/interaction-buttons'
import { ApiError } from '@/shared/api/api-error'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Textarea } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

export function CommentSection({
  postId,
  postAuthorId,
  communityName,
  commentCount,
  isCommunityAdmin,
}: {
  postId: string
  postAuthorId: string | undefined
  communityName: string
  commentCount: number
  isCommunityAdmin: boolean
}) {
  const status = useSession((s) => s.status)
  const meId = useSession((s) => s.user?.userId)
  const isAuth = status === 'authenticated'

  const [sort, setSort] = useState<CommentSort>('time')
  const [searchParams, setSearchParams] = useSearchParams()
  const anchorCommentId = searchParams.get('comment')
  const anchorRootId = searchParams.get('root')

  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>(() =>
    anchorRootId ? { [anchorRootId]: true } : {},
  )
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [adminDeleteTarget, setAdminDeleteTarget] = useState<string | null>(null)
  const [adminDeleteError, setAdminDeleteError] = useState<string | null>(null)
  const [banTarget, setBanTarget] = useState<{ userId: string; nickname: string } | null>(null)

  const commentsQuery = useComments(postId, sort)
  const createComment = useCreateComment(postId)
  const deleteComment = useDeleteComment(postId)

  const items = useMemo(
    () => commentsQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [commentsQuery.data],
  )

  const userIds = useMemo(() => collectCommentUserIds(items), [items])
  const { data: users } = useUserSummaries(userIds)

  const commentTargets = useMemo(
    () => items.map((c) => `COMMENT:${c.id ?? ''}`).filter((t) => t !== 'COMMENT:'),
    [items],
  )
  const { data: states } = useInteractionStates(commentTargets, isAuth)
  const likedSet = useMemo(() => {
    const s = new Set<string>()
    for (const st of states ?? []) {
      if (st.targetType === 'COMMENT' && st.liked && st.targetId) s.add(st.targetId)
    }
    return s
  }, [states])

  // 锚点评论自动滚动 + 2 秒极光脉冲高亮 + 清理 URL 参数
  useEffect(() => {
    if (!anchorCommentId) return
    let cancelled = false
    const deadline = Date.now() + 3000

    const tryScroll = () => {
      if (cancelled) return
      const el = document.getElementById(`comment-${anchorCommentId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedId(anchorCommentId)
        const next = new URLSearchParams(searchParams)
        next.delete('comment')
        next.delete('root')
        setSearchParams(next, { replace: true })
        window.setTimeout(() => {
          if (!cancelled) setHighlightedId(null)
        }, 2300)
        return
      }
      if (Date.now() < deadline) {
        window.setTimeout(tryScroll, 180)
      } else {
        const next = new URLSearchParams(searchParams)
        next.delete('comment')
        next.delete('root')
        setSearchParams(next, { replace: true })
      }
    }

    tryScroll()
    return () => {
      cancelled = true
    }
  }, [anchorCommentId, searchParams, setSearchParams])

  const confirmAdminDelete = () => {
    if (!adminDeleteTarget) return
    setAdminDeleteError(null)
    deleteComment.mutate(adminDeleteTarget, {
      onSuccess: () => {
        setAdminDeleteTarget(null)
      },
      onError: (err) => {
        setAdminDeleteError(err instanceof ApiError ? err.message : '删除评论失败')
      },
    })
  }

  return (
    <section data-testid="comment-section" className="mt-8 space-y-5">
      {/* 评论区顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <MessageCircle className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-bold text-foreground">评论讨论</h2>
          <span
            data-testid="comment-count"
            className="tabular-nums rounded-full border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-2.5 py-0.5 font-mono text-xs font-semibold text-secondary-foreground"
          >
            {String(commentCount)}
          </span>
        </div>

        {(commentCount > 1 || items.length > 1) && (
          <Segmented
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'time', label: '最新' },
              { value: 'hot', label: '热度' },
            ]}
          />
        )}
      </div>

      {/* 发一级评论输入框 */}
      {isAuth ? (
        <CommentComposer
          postId={postId}
          placeholder="写下你的观点，支持 @昵称 提醒本社群成员…"
          pending={createComment.isPending}
          onSubmit={(body, onDone, onErr) => {
            createComment.mutate(
              { body },
              {
                onSuccess: () => onDone(),
                onError: (err) => onErr(err instanceof ApiError ? err.message : '评论发送失败'),
              },
            )
          }}
        />
      ) : (
        <Card padding="sm" spotlight={false} className="rounded-2xl text-center">
          <p data-testid="comment-login-hint" className="text-sm text-muted-foreground">
            <Link to="/login" className="font-semibold text-primary hover:underline">
              登录
            </Link>{' '}
            并加入社群后即可参与评论讨论
          </p>
        </Card>
      )}

      {/* 评论列表 */}
      {commentsQuery.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p
          data-testid="comment-empty"
          className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-surface)] py-10 text-center text-sm text-muted-foreground"
        >
          还没有评论，来发表第一条精彩见解吧。
        </p>
      ) : (
        <ul data-testid="comment-list" className="m-0 list-none space-y-3 p-0">
          {items.map((c) => {
            const id = c.id ?? ''
            const isExpanded = Boolean(expandedRoots[id]) || anchorRootId === id
            return (
              <TopLevelCommentItem
                key={id}
                comment={c}
                author={pickAuthor(users, c.authorId)}
                postId={postId}
                postAuthorId={postAuthorId}
                meId={meId}
                isAuth={isAuth}
                isCommunityAdmin={isCommunityAdmin}
                liked={likedSet.has(id)}
                expanded={isExpanded}
                highlightedId={highlightedId}
                onToggleExpand={() =>
                  setExpandedRoots((prev) => ({ ...prev, [id]: !isExpanded }))
                }
                onSelfDelete={(cid) => deleteComment.mutate(cid)}
                onAdminDelete={(cid) => {
                  setAdminDeleteError(null)
                  setAdminDeleteTarget(cid)
                }}
                onAdminBan={(uid, nick) => setBanTarget({ userId: uid, nickname: nick })}
              />
            )
          })}
        </ul>
      )}

      {commentsQuery.hasNextPage && (
        <div className="pt-2 text-center">
          <Button
            variant="secondary"
            size="sm"
            data-testid="btn-more-comments"
            disabled={commentsQuery.isFetchingNextPage}
            onClick={() => void commentsQuery.fetchNextPage()}
          >
            {commentsQuery.isFetchingNextPage ? '加载中…' : '查看更多评论'}
          </Button>
        </div>
      )}

      {/* 管理员删评确认弹窗 */}
      <ConfirmDialog
        open={Boolean(adminDeleteTarget)}
        onClose={() => setAdminDeleteTarget(null)}
        onConfirm={confirmAdminDelete}
        title="确认以管理员身份删除该评论？"
        description="删除后该评论内容将变为「该评论已删除」占位，并同步更新帖子评论数。"
        confirmLabel="确认删除"
        danger
        pending={deleteComment.isPending}
        error={adminDeleteError}
        testId="admin-delete-comment-dialog"
        confirmTestId="btn-confirm-delete-comment"
      />

      {/* 管理员封禁评论作者弹窗 */}
      {banTarget && (
        <BanMemberDialog
          open={Boolean(banTarget)}
          onClose={() => setBanTarget(null)}
          communityName={communityName}
          targetUserId={banTarget.userId}
          targetNickname={banTarget.nickname}
        />
      )}
    </section>
  )
}

function CommentComposer({
  postId,
  replyTo,
  placeholder,
  pending,
  onSubmit,
  onCancel,
}: {
  postId?: string | undefined
  replyTo?: { commentId: string; nickname: string } | undefined
  placeholder: string
  pending: boolean
  onSubmit: (body: string, onDone: () => void, onErr: (msg: string) => void) => void
  onCancel?: (() => void) | undefined
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const draftPrefill = useAiStore((s) => s.draftCommentPrefill)
  const consumePrefill = useAiStore((s) => s.consumeDraftCommentPrefill)

  useEffect(() => {
    if (replyTo || !postId || !draftPrefill || draftPrefill.postId !== postId) return
    const timer = window.setTimeout(() => {
      const text = consumePrefill(postId)
      if (text) {
        setBody(text)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [postId, replyTo, draftPrefill, consumePrefill])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const clean = body.trim()
    if (!clean) {
      setError('评论内容不能为空')
      return
    }
    onSubmit(
      clean,
      () => {
        setBody('')
        onCancel?.()
      },
      (msg) => setError(msg),
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel rounded-2xl p-3.5 space-y-2.5"
    >
      {replyTo && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            正在回复 <strong className="text-primary">{replyTo.nickname}</strong>
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer text-xs hover:text-foreground"
            >
              取消
            </button>
          )}
        </div>
      )}
      {!replyTo && postId && (
        <Suspense fallback={null}>
          <AiComposeBar
            variant="reply"
            postId={postId}
            draft={body}
            onReplace={(text) => setBody(text)}
            onInsert={(text) => setBody((prev) => (prev ? `${prev}\n${text}` : text))}
          />
        </Suspense>
      )}
      <Textarea
        data-testid={replyTo ? 'field-reply-body' : 'field-comment-body'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={replyTo ? 2 : 3}
        maxLength={2000}
      />
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="tabular-nums text-[11px] text-muted-foreground">
          {String(body.length)} / 2000
        </span>
        <Button
          type="submit"
          size="sm"
          data-testid={replyTo ? 'btn-submit-reply' : 'btn-submit-comment'}
          disabled={pending}
        >
          <Send className="h-3.5 w-3.5" />
          {pending ? '发送中…' : replyTo ? '发送回复' : '发表评论'}
        </Button>
      </div>
    </form>
  )
}

function TopLevelCommentItem({
  comment,
  author,
  postId,
  postAuthorId,
  meId,
  isAuth,
  isCommunityAdmin,
  liked,
  expanded,
  highlightedId,
  onToggleExpand,
  onSelfDelete,
  onAdminDelete,
  onAdminBan,
}: {
  comment: CommentView
  author: UserSummary | null
  postId: string
  postAuthorId: string | undefined
  meId: string | undefined
  isAuth: boolean
  isCommunityAdmin: boolean
  liked: boolean
  expanded: boolean
  highlightedId: string | null
  onToggleExpand: () => void
  onSelfDelete: (commentId: string) => void
  onAdminDelete: (commentId: string) => void
  onAdminBan: (userId: string, nickname: string) => void
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const createComment = useCreateComment(postId)

  const id = comment.id ?? ''
  const nick = author?.nickname ?? '已注销用户'
  const isOwner = Boolean(meId && meId === comment.authorId)
  const isPostAuthor = Boolean(postAuthorId && postAuthorId === comment.authorId)
  const isHighlighted = highlightedId === id
  const replyCount = comment.replyCount ?? 0

  return (
    <li
      id={`comment-${id}`}
      data-testid="comment-item"
      className={cn(
        'glass-panel rounded-2xl p-4 transition-all',
        isHighlighted && 'comment-anchor-flash',
      )}
    >
      {comment.deleted ? (
        <p data-testid="comment-deleted" className="text-xs italic text-muted-foreground">
          该评论已删除
        </p>
      ) : (
        <div className="space-y-2.5">
          {/* 评论作者头 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {comment.authorId ? (
                <Link
                  to={`/u/${encodeURIComponent(comment.authorId)}`}
                  data-testid="comment-author-link"
                  className="inline-flex items-center gap-2 min-w-0 group"
                >
                  <Avatar name={nick} src={author?.avatarUrl} size="xs" />
                  <span
                    data-testid="comment-author"
                    className="truncate text-sm font-bold text-foreground group-hover:text-primary"
                  >
                    {nick}
                  </span>
                </Link>
              ) : (
                <span data-testid="comment-author" className="text-sm font-medium text-muted-foreground">
                  {nick}
                </span>
              )}
              {isPostAuthor && (
                <Pill tone="primary" data-testid="author-badge">
                  作者
                </Pill>
              )}
            </div>
            <span className="tabular-nums shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(comment.createdAt)}
            </span>
          </div>

          {/* 评论正文（支持 @mention 链接） */}
          <p
            data-testid="comment-body"
            className="whitespace-pre-wrap text-sm leading-relaxed text-secondary-foreground"
          >
            <MentionText body={comment.body} mentions={comment.mentions} />
          </p>

          {/* 评论操作条 */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <LikeButton
              targetType="COMMENT"
              targetId={id}
              liked={liked}
              count={comment.likeCount ?? 0}
              compact
            />

            {isAuth && (
              <button
                type="button"
                data-testid="btn-reply"
                onClick={() => setReplyOpen((v) => !v)}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-foreground"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                回复
              </button>
            )}

            {isOwner && (
              <button
                type="button"
                data-testid="btn-delete-comment"
                onClick={() => onSelfDelete(id)}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--color-danger-soft)] hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            )}

            {isCommunityAdmin && !isOwner && (
              <>
                <button
                  type="button"
                  data-testid="admin-delete-comment"
                  onClick={() => onAdminDelete(id)}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-danger transition-colors hover:bg-[var(--color-danger-soft)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  管理员删评
                </button>
                {comment.authorId && (
                  <button
                    type="button"
                    data-testid="admin-ban-comment-author"
                    onClick={() => onAdminBan(comment.authorId ?? '', nick)}
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-danger transition-colors hover:bg-[var(--color-danger-soft)]"
                  >
                    <ShieldBan className="h-3.5 w-3.5" />
                    封禁
                  </button>
                )}
              </>
            )}
          </div>

          {/* 回复输入框 */}
          {replyOpen && (
            <div className="pt-2">
              <CommentComposer
                replyTo={{ commentId: id, nickname: nick }}
                placeholder={`回复 ${nick}…`}
                pending={createComment.isPending}
                onCancel={() => setReplyOpen(false)}
                onSubmit={(body, onDone, onErr) => {
                  createComment.mutate(
                    { body, replyToCommentId: id },
                    {
                      onSuccess: () => {
                        onDone()
                        if (!expanded) onToggleExpand()
                      },
                      onError: (err) =>
                        onErr(err instanceof ApiError ? err.message : '回复发送失败'),
                    },
                  )
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 展开 / 收起二级回复 */}
      {replyCount > 0 && (
        <div className="mt-3 border-t border-[var(--border-glass)] pt-2.5">
          <button
            type="button"
            data-testid="btn-expand-replies"
            onClick={onToggleExpand}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-[var(--color-primary-soft)]"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                收起回复
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                展开 {String(replyCount)} 条回复
              </>
            )}
          </button>

          {expanded && (
            <ReplyList
              rootCommentId={id}
              postId={postId}
              postAuthorId={postAuthorId}
              meId={meId}
              isAuth={isAuth}
              isCommunityAdmin={isCommunityAdmin}
              highlightedId={highlightedId}
              onSelfDelete={onSelfDelete}
              onAdminDelete={onAdminDelete}
              onAdminBan={onAdminBan}
            />
          )}
        </div>
      )}
    </li>
  )
}

function ReplyList({
  rootCommentId,
  postId,
  postAuthorId,
  meId,
  isAuth,
  isCommunityAdmin,
  highlightedId,
  onSelfDelete,
  onAdminDelete,
  onAdminBan,
}: {
  rootCommentId: string
  postId: string
  postAuthorId: string | undefined
  meId: string | undefined
  isAuth: boolean
  isCommunityAdmin: boolean
  highlightedId: string | null
  onSelfDelete: (commentId: string) => void
  onAdminDelete: (commentId: string) => void
  onAdminBan: (userId: string, nickname: string) => void
}) {
  const repliesQuery = useReplies(rootCommentId)
  const createComment = useCreateComment(postId)
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; nickname: string } | null>(
    null,
  )

  const replies = useMemo(
    () => repliesQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [repliesQuery.data],
  )
  const userIds = useMemo(() => collectCommentUserIds(replies), [replies])
  const { data: users } = useUserSummaries(userIds)

  const targets = useMemo(
    () => replies.map((r) => `COMMENT:${r.id ?? ''}`).filter((t) => t !== 'COMMENT:'),
    [replies],
  )
  const { data: states } = useInteractionStates(targets, isAuth)
  const likedSet = useMemo(() => {
    const s = new Set<string>()
    for (const st of states ?? []) {
      if (st.targetType === 'COMMENT' && st.liked && st.targetId) s.add(st.targetId)
    }
    return s
  }, [states])

  if (repliesQuery.isPending) {
    return (
      <div className="mt-2.5 space-y-2 pl-4">
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="mt-2.5 space-y-2.5 border-l-2 border-[rgba(var(--accent-rgb),0.28)] pl-4">
      <ul data-testid="reply-list" className="m-0 list-none space-y-2.5 p-0">
        {replies.map((r) => {
          const rid = r.id ?? ''
          const author = pickAuthor(users, r.authorId)
          const replyToUser = pickAuthor(users, r.replyToUserId)
          const nick = author?.nickname ?? '已注销用户'
          const isOwner = Boolean(meId && meId === r.authorId)
          const isPostAuthor = Boolean(postAuthorId && postAuthorId === r.authorId)
          const showReplyTo = Boolean(r.replyToCommentId && r.replyToCommentId !== rootCommentId && replyToUser)

          return (
            <li
              key={rid}
              id={`comment-${rid}`}
              data-testid="reply-item"
              className={cn(
                'rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-3 transition-all',
                highlightedId === rid && 'comment-anchor-flash',
              )}
            >
              {r.deleted ? (
                <p data-testid="reply-deleted" className="text-xs italic text-muted-foreground">
                  该回复已删除
                </p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {r.authorId ? (
                        <Link
                          to={`/u/${encodeURIComponent(r.authorId)}`}
                          data-testid="reply-author-link"
                          className="inline-flex items-center gap-1.5 group"
                        >
                          <Avatar name={nick} src={author?.avatarUrl} size="xs" />
                          <span
                            data-testid="reply-author"
                            className="truncate font-bold text-foreground group-hover:text-primary"
                          >
                            {nick}
                          </span>
                        </Link>
                      ) : (
                        <span data-testid="reply-author" className="font-medium text-muted-foreground">
                          {nick}
                        </span>
                      )}
                      {isPostAuthor && <Pill tone="primary">作者</Pill>}
                      {showReplyTo && (
                        <span data-testid="reply-to" className="text-muted-foreground">
                          回复 <strong className="text-secondary-foreground">{replyToUser?.nickname}</strong>
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(r.createdAt)}
                    </span>
                  </div>

                  <p
                    data-testid="reply-body"
                    className="whitespace-pre-wrap text-xs leading-relaxed text-secondary-foreground sm:text-sm"
                  >
                    <MentionText body={r.body} mentions={r.mentions} />
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <LikeButton
                      targetType="COMMENT"
                      targetId={rid}
                      liked={likedSet.has(rid)}
                      count={r.likeCount ?? 0}
                      compact
                    />

                    {isAuth && (
                      <button
                        type="button"
                        data-testid="btn-reply-to-reply"
                        onClick={() => setReplyTarget({ commentId: rid, nickname: nick })}
                        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground"
                      >
                        <CornerDownRight className="h-3 w-3" />
                        回复
                      </button>
                    )}

                    {isOwner && (
                      <button
                        type="button"
                        data-testid="btn-delete-reply"
                        onClick={() => onSelfDelete(rid)}
                        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    )}

                    {isCommunityAdmin && !isOwner && (
                      <>
                        <button
                          type="button"
                          data-testid="admin-delete-reply"
                          onClick={() => onAdminDelete(rid)}
                          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2 text-xs text-danger hover:bg-[var(--color-danger-soft)]"
                        >
                          <Trash2 className="h-3 w-3" />
                          删评
                        </button>
                        {r.authorId && (
                          <button
                            type="button"
                            data-testid="admin-ban-comment-author"
                            onClick={() => onAdminBan(r.authorId ?? '', nick)}
                            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-xl px-2 text-xs text-danger hover:bg-[var(--color-danger-soft)]"
                          >
                            <ShieldBan className="h-3 w-3" />
                            封禁
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {replyTarget && (
        <CommentComposer
          replyTo={replyTarget}
          placeholder={`回复 ${replyTarget.nickname}…`}
          pending={createComment.isPending}
          onCancel={() => setReplyTarget(null)}
          onSubmit={(body, onDone, onErr) => {
            createComment.mutate(
              { body, replyToCommentId: replyTarget.commentId },
              {
                onSuccess: () => onDone(),
                onError: (err) => onErr(err instanceof ApiError ? err.message : '回复发送失败'),
              },
            )
          }}
        />
      )}

      {repliesQuery.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={repliesQuery.isFetchingNextPage}
          onClick={() => void repliesQuery.fetchNextPage()}
        >
          {repliesQuery.isFetchingNextPage ? '加载中…' : '查看更多回复'}
        </Button>
      )}
    </div>
  )
}
