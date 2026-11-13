import { useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  collectCommentUserIds,
  pickAuthor,
  useComments,
  useCreateComment,
  useDeleteComment,
  useReplies,
  useUserSummaries,
  type CommentView,
} from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/cn'

/**
 * 评论区。
 *
 * 两级平铺：一级评论下面直接列出它名下的**所有**回复，不再按层级缩进。
 * `replyToUserId` 用「回复 @某人」表达对话关系——这就是不用缩进也读得懂的原因。
 *
 * tombstone（已删除但有回复）显示成"该评论已删除"，且**仍然可以展开回复**：
 * 位置还在，回复不该跟着消失。
 */
export function CommentSection({ postId, commentCount }: { postId: string; commentCount: number }) {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const list = useComments(postId)
  const items = (list.data?.pages ?? []).flatMap((p) => p.items ?? [])

  return (
    <section className="space-y-3" data-testid="comment-section">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">评论</h2>
        {/* 计数为 0 不显示 */}
        {commentCount > 0 ? (
          <span className="text-[11px] text-muted-foreground" data-testid="comment-count">
            {commentCount}
          </span>
        ) : null}
      </div>

      {authed ? (
        <CommentComposer postId={postId} replyTo={undefined} onDone={undefined} autoFocus={undefined} />
      ) : (
        <p className="text-[11px] text-muted-foreground" data-testid="comment-login-hint">
          登录后可以发表评论
        </p>
      )}

      {list.isPending ? (
        <p className="text-[11px] text-muted-foreground">加载中…</p>
      ) : list.isError ? (
        <p className="text-[11px] text-danger">{authErrorMessage(list.error)}</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="comment-empty">
          还没有评论，来说两句
        </p>
      ) : (
        <ul className="space-y-3" data-testid="comment-list">
          {items.map((c) => (
            <li key={c.id}>
              <TopLevelComment comment={c} postId={postId} />
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage ? (
        <button
          type="button"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="w-full py-1 text-[11px] text-muted-foreground hover:underline"
          data-testid="btn-more-comments"
        >
          {list.isFetchingNextPage ? '加载中…' : '加载更多评论'}
        </button>
      ) : null}
    </section>
  )
}

function CommentComposer({
  postId,
  replyTo,
  onDone,
  autoFocus,
}: {
  postId: string
  replyTo: string | undefined
  onDone: (() => void) | undefined
  autoFocus: boolean | undefined
}) {
  const create = useCreateComment(postId)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (body.trim() === '') return
    setError(null)
    // exactOptionalPropertyTypes: 一级评论要**省略** replyToCommentId，不能传 undefined
    const payload = replyTo ? { replyToCommentId: replyTo, body } : { body }
    create.mutate(payload, {
      onSuccess: () => {
        setBody('')
        onDone?.()
      },
      onError: (err) => setError(authErrorMessage(err)),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        data-testid={replyTo ? 'field-reply-body' : 'field-comment-body'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={replyTo ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={replyTo ? '写下你的回复…' : '写下你的评论…'}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={create.isPending}
          data-testid={replyTo ? 'btn-submit-reply' : 'btn-submit-comment'}
        >
          {create.isPending ? '发送中…' : replyTo ? '回复' : '发表'}
        </Button>
        {error ? <span className="text-[11px] text-danger">{error}</span> : null}
      </div>
    </form>
  )
}

function TopLevelComment({ comment, postId }: { comment: CommentView; postId: string }) {
  const { name } = useParams<{ name: string }>()
  const session = useSession((s) => s.user)
  const del = useDeleteComment(postId)
  const [replying, setReplying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const authors = useUserSummaries([comment.authorId])
  const author = pickAuthor(authors.data, comment.authorId)
  const isMine = session?.userId === comment.authorId

  return (
    <div className="rounded-md border border-border p-2.5" data-testid="comment-item">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {comment.deleted ? (
          <span data-testid="comment-deleted">该评论已删除</span>
        ) : (
          <>
            <Avatar url={author?.avatarUrl ?? null} name={author?.nickname ?? ''} size={16} />
            <span data-testid="comment-author">{author?.nickname ?? '…'}</span>
          </>
        )}
        <span>·</span>
        <span>{comment.createdAt?.slice(0, 19).replace('T', ' ')}</span>
      </div>

      {!comment.deleted ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm" data-testid="comment-body">
          {comment.body}
        </p>
      ) : null}

      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
        {!comment.deleted ? (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="hover:underline"
            data-testid="btn-reply"
          >
            回复
          </button>
        ) : null}
        {isMine && !comment.deleted ? (
          <button
            type="button"
            onClick={() => del.mutate(comment.id ?? '')}
            disabled={del.isPending}
            className="hover:underline"
            data-testid="btn-delete-comment"
          >
            删除
          </button>
        ) : null}
        {/* 展开 N 条回复：N 是后代总数（不是直接子节点数），与展开后条数一致 */}
        {(comment.replyCount ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="hover:underline"
            data-testid="btn-expand-replies"
          >
            {expanded ? '收起回复' : `展开 ${comment.replyCount ?? 0} 条回复`}
          </button>
        ) : null}
        <Link to={`/c/${encodeURIComponent(name ?? '')}`} className="ml-auto opacity-0">
          ·
        </Link>
      </div>

      {replying ? (
        <div className="mt-2">
          <CommentComposer
            postId={postId}
            replyTo={comment.id ?? ''}
            autoFocus
            onDone={() => {
              setReplying(false)
              setExpanded(true)
            }}
          />
        </div>
      ) : null}

      {expanded ? <ReplyList rootCommentId={comment.id ?? null} postId={postId} /> : null}
    </div>
  )
}

function ReplyList({ rootCommentId, postId }: { rootCommentId: string | null; postId: string }) {
  const replies = useReplies(rootCommentId)
  const items = (replies.data?.pages ?? []).flatMap((p) => p.items ?? [])

  if (replies.isPending) {
    return <p className="mt-2 text-[11px] text-muted-foreground">加载回复…</p>
  }
  if (replies.isError) {
    return <p className="mt-2 text-[11px] text-danger">{authErrorMessage(replies.error)}</p>
  }

  return (
    <ul className="mt-2 space-y-2 border-l-2 border-border pl-2.5" data-testid="reply-list">
      {items.map((r) => (
        <li key={r.id}>
          <ReplyItem comment={r} postId={postId} />
        </li>
      ))}
      {replies.hasNextPage ? (
        <li>
          <button
            type="button"
            onClick={() => void replies.fetchNextPage()}
            className="text-[11px] text-muted-foreground hover:underline"
          >
            加载更多回复
          </button>
        </li>
      ) : null}
    </ul>
  )
}

function ReplyItem({ comment, postId }: { comment: CommentView; postId: string }) {
  const session = useSession((s) => s.user)
  const del = useDeleteComment(postId)
  const authors = useUserSummaries(collectCommentUserIds([comment]))
  const author = pickAuthor(authors.data, comment.authorId)
  const replyTo = pickAuthor(authors.data, comment.replyToUserId)
  const isMine = session?.userId === comment.authorId

  return (
    <div data-testid="reply-item" className={cn('text-sm', comment.deleted && 'text-muted-foreground')}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {comment.deleted ? (
          <span data-testid="reply-deleted">该回复已删除</span>
        ) : (
          <>
            <Avatar url={author?.avatarUrl ?? null} name={author?.nickname ?? ''} size={14} />
            <span data-testid="reply-author">{author?.nickname ?? '…'}</span>
            {/* 「回复 @某人」——两级平铺下用它表达对话关系，不用缩进 */}
            {comment.replyToUserId ? (
              <span data-testid="reply-to">
                回复 @{replyTo?.nickname ?? '某人'}
              </span>
            ) : null}
            <span>·</span>
            <span>{comment.createdAt?.slice(0, 19).replace('T', ' ')}</span>
            {isMine ? (
              <button
                type="button"
                onClick={() => del.mutate(comment.id ?? '')}
                disabled={del.isPending}
                className="hover:underline"
                data-testid="btn-delete-reply"
              >
                删除
              </button>
            ) : null}
          </>
        )}
      </div>
      {!comment.deleted ? (
        <p className="whitespace-pre-wrap break-words" data-testid="reply-body">
          {comment.body}
        </p>
      ) : null}
    </div>
  )
}
