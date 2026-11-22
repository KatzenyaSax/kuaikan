import { createContext, useContext, useState } from 'react'
import { Link } from 'react-router'
import {
  collectCommentUserIds,
  pickAuthor,
  useComments,
  useCreateComment,
  useDeleteComment,
  useReplies,
  useUserSummaries,
  type CommentSort,
  type CommentView,
} from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { useInteractionStates } from '@/features/interaction/api'
import { LikeButton } from '@/features/interaction/interaction-buttons'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/field'
import { relativeTime } from '@/shared/lib/time'
import { MentionText } from '@/features/content/mention-text'
import { Segmented } from '@/shared/ui/segmented'
import { cn } from '@/shared/lib/cn'

/**
 * 帖子作者 id。评论里要标「楼主」——几乎所有论坛都这么做，
 * 因为它决定"这条回复的分量"，读者一眼就能看出来。
 *
 * 用 context 而不是逐层传参：`CommentSection` → `TopLevelComment` →
 * `ReplyList` → `ReplyItem` 有四层，多一个参数会把每层签名都挤满。
 * context 只在本模块内可见，不污染外部。
 */
const PostAuthorContext = createContext<string | undefined>(undefined)

/**
 * 评论行的次级动作（回复 / 删除 / 展开）的胶囊形态。
 *
 * 用小胶囊而不是纯文字：它们是**可点的**，而 12px 纯灰字看起来像标签。
 * 胶囊在 hover 时才亮底，所以不点的时候仍然安静。
 */
const ACTION_CLASS =
  'inline-flex h-7 items-center rounded-full px-2 text-caption text-faint ' +
  'transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground'

/** 「楼主」小标。刻意用浅灰而不是蓝色——蓝色在本项目里只表示“可点” */
function AuthorBadge() {
  return (
    <span
      className="inline-flex h-[18px] items-center rounded-full bg-fill px-2 align-middle text-caption font-medium leading-none text-muted-foreground"
      data-testid="author-badge"
    >
      楼主
    </span>
  )
}

/**
 * 评论区。
 *
 * 两级平铺：一级评论下面直接列出它名下的**所有**回复，不再按层级缩进。
 * `replyToUserId` 用「回复 @某人」表达对话关系 —— 这就是不用缩进也读得懂的原因。
 *
 * tombstone（已删除但有回复）显示成"该评论已删除"，且**仍然可以展开回复**：
 * 位置还在，回复不该跟着消失。
 *
 * 分区只有一条 1px hairline，没有背景块、没有卡片。
 */
export function CommentSection({
  postId,
  commentCount,
  postAuthorId,
}: {
  postId: string
  commentCount: number
  postAuthorId?: string | undefined
}) {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  // 默认时间序。热度序是可选视图，不是替换——"我刚发的评论应该看得见"更符合直觉。
  const [sort, setSort] = useState<CommentSort>('time')
  const list = useComments(postId, sort)
  const items = (list.data?.pages ?? []).flatMap((p) => p.items ?? [])

  return (
    <PostAuthorContext.Provider value={postAuthorId}>
      <section className="mt-16" data-testid="comment-section">
      <div className="mb-6 flex items-center gap-2.5">
        <h2 className="m-0 text-sub font-semibold">评论</h2>
        {/* 计数为 0 不显示 */}
        {commentCount > 0 ? (
          <span className="text-aux text-faint" data-testid="comment-count">
            {commentCount}
          </span>
        ) : null}
        {/* 只有一个评论时不显示切换——切了也看不出区别 */}
        {commentCount > 1 ? (
          <Segmented
            className="ml-auto"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'time', label: '最新' },
              { value: 'hot', label: '热度' },
            ]}
          />
        ) : null}
      </div>

      {authed ? (
        <CommentComposer postId={postId} replyTo={undefined} onDone={undefined} autoFocus={undefined} />
      ) : (
        <p className="m-0 text-aux text-muted-foreground" data-testid="comment-login-hint">
          登录后可以发表评论
        </p>
      )}

      {list.isPending ? (
        <p className="mt-8 text-aux text-faint">加载中…</p>
      ) : list.isError ? (
        <p className="mt-8 text-aux text-danger">{authErrorMessage(list.error)}</p>
      ) : items.length === 0 ? (
        <p className="mt-8 text-aux text-faint" data-testid="comment-empty">
          还没有评论，来说两句
        </p>
      ) : (
        <ul className="m-0 mt-7 list-none p-0" data-testid="comment-list">
          {items.map((c) => (
            <li key={c.id} className="py-5 [&+&]:border-t [&+&]:border-border">
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
          className="mt-1 w-full rounded-full py-2.5 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground"
          data-testid="btn-more-comments"
        >
          {list.isFetchingNextPage ? '加载中…' : '加载更多评论'}
        </button>
      ) : null}
      </section>
    </PostAuthorContext.Provider>
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
    <form onSubmit={submit}>
      <Textarea
        data-testid={replyTo ? 'field-reply-body' : 'field-comment-body'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={replyTo ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={replyTo ? '写下你的回复…' : '写下你的评论…'}
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="submit"
          disabled={create.isPending}
          data-testid={replyTo ? 'btn-submit-reply' : 'btn-submit-comment'}
        >
          {create.isPending ? '发送中…' : replyTo ? '回复' : '发表'}
        </Button>
        {error ? <span className="text-aux text-danger">{error}</span> : null}
      </div>
    </form>
  )
}

function TopLevelComment({ comment, postId }: { comment: CommentView; postId: string }) {
  const session = useSession((s) => s.user)
  const authed = useSession((s) => s.status) === 'authenticated'
  const del = useDeleteComment(postId)
  const [replying, setReplying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const authors = useUserSummaries([comment.authorId])
  const author = pickAuthor(authors.data, comment.authorId)
  const isMine = session?.userId === comment.authorId
  // useContext 必须在顶层无条件调用：写在 && 右边会因为短路而跳过，
  // 渲染次数一变 hooks 顺序就变了（lint 的 rules-of-hooks 抓的就是这个）
  const postAuthorId = useContext(PostAuthorContext)
  const isPostAuthor = !!comment.authorId && comment.authorId === postAuthorId
  const states = useInteractionStates(comment.id ? [`comment:${comment.id}`] : [], authed)

  return (
    <div
      data-testid="comment-item"
      data-comment-anchor={comment.id}
      className="scroll-mt-24 rounded-md transition-colors duration-500 data-[highlighted=true]:bg-primary-soft"
    >
      <div className="flex items-center gap-2 text-aux text-faint">
        {comment.deleted ? (
          <span data-testid="comment-deleted">该评论已删除</span>
        ) : (
          <>
            {/* 头像 + 昵称整体是一个链接：点击热区够大，也支持 cmd+click */}
            <Link
              to={`/u/${encodeURIComponent(comment.authorId ?? '')}`}
              className="inline-flex min-w-0 items-center gap-2 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
              data-testid="comment-author-link"
            >
              <Avatar url={author?.avatarUrl ?? null} name={author?.nickname ?? ''} size={24} />
              <span
                className="truncate text-body font-medium text-foreground"
                data-testid="comment-author"
              >
                {author?.nickname ?? '…'}
              </span>
            </Link>
            {isPostAuthor ? <AuthorBadge /> : null}
            <span>·</span>
            <span>{relativeTime(comment.createdAt)}</span>
          </>
        )}
      </div>

      {!comment.deleted ? (
        <p
          className="m-0 mt-2.5 whitespace-pre-wrap break-words text-body leading-[1.75] text-foreground"
          data-testid="comment-body"
        >
          <MentionText body={comment.body} mentions={comment.mentions} />
        </p>
      ) : null}

      <div className="mt-1.5 -ml-2 flex items-center gap-1 text-caption text-faint">
        {!comment.deleted ? (
          <LikeButton
            compact
            targetType="comment"
            targetId={comment.id ?? ''}
            count={comment.likeCount ?? 0}
            states={states.data}
          />
        ) : null}
        {!comment.deleted ? (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className={ACTION_CLASS}
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
            className={ACTION_CLASS}
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
            className={ACTION_CLASS}
            data-testid="btn-expand-replies"
            // 从消息跳进来时，滚动逻辑靠这个属性找到“要展开哪一个 root”
            data-expand-root={comment.id}
          >
            {expanded ? '收起回复' : `展开 ${String(comment.replyCount ?? 0)} 条回复`}
          </button>
        ) : null}
      </div>

      {replying ? (
        <div className="mt-3">
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
    return <p className="mt-3 text-aux text-faint">加载回复…</p>
  }
  if (replies.isError) {
    return <p className="mt-3 text-aux text-danger">{authErrorMessage(replies.error)}</p>
  }

  return (
    <ul
      className="m-0 mt-4 list-none border-l border-border p-0 pl-4"
      data-testid="reply-list"
    >
      {items.map((r) => (
        <li key={r.id} className="py-3 [&+&]:border-t [&+&]:border-border">
          <ReplyItem comment={r} postId={postId} />
        </li>
      ))}
      {replies.hasNextPage ? (
        <li className="py-2">
          <button
            type="button"
            onClick={() => void replies.fetchNextPage()}
            className="rounded-full px-2 text-caption text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground"
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
  const authed = useSession((st) => st.status) === 'authenticated'
  const del = useDeleteComment(postId)
  const [replying, setReplying] = useState(false)
  const states = useInteractionStates(comment.id ? [`comment:${comment.id}`] : [], authed)
  const authors = useUserSummaries(collectCommentUserIds([comment]))
  const author = pickAuthor(authors.data, comment.authorId)
  const replyTo = pickAuthor(authors.data, comment.replyToUserId)
  const isMine = session?.userId === comment.authorId
  const postAuthorId = useContext(PostAuthorContext)
  const isPostAuthor = !!comment.authorId && comment.authorId === postAuthorId

  return (
    <div
      data-testid="reply-item"
      data-comment-anchor={comment.id}
      className={cn(
        'scroll-mt-24 rounded-md transition-colors duration-500 data-[highlighted=true]:bg-primary-soft',
        comment.deleted && 'text-muted-foreground',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-caption text-faint">
        {comment.deleted ? (
          <span data-testid="reply-deleted">该回复已删除</span>
        ) : (
          <>
            <Link
              to={`/u/${encodeURIComponent(comment.authorId ?? '')}`}
              className="inline-flex min-w-0 items-center gap-1.5 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
              data-testid="reply-author-link"
            >
              <Avatar url={author?.avatarUrl ?? null} name={author?.nickname ?? ''} size={18} />
              <span className="truncate font-medium text-foreground" data-testid="reply-author">
                {author?.nickname ?? '…'}
              </span>
            </Link>
            {isPostAuthor ? <AuthorBadge /> : null}
            {/* 「回复 @某人」——两级平铺下用它表达对话关系，不用缩进 */}
            {comment.replyToUserId ? (
              <Link
                to={`/u/${encodeURIComponent(comment.replyToUserId)}`}
                className="rounded-[3px] text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline"
                data-testid="reply-to"
              >
                回复 @{replyTo?.nickname ?? '某人'}
              </Link>
            ) : null}
            <span>·</span>
            <span>{relativeTime(comment.createdAt)}</span>
          </>
        )}
      </div>

      {!comment.deleted ? (
        <p
          className="m-0 mt-1.5 whitespace-pre-wrap break-words text-body leading-[1.75] text-foreground"
          data-testid="reply-body"
        >
          <MentionText body={comment.body} mentions={comment.mentions} />
        </p>
      ) : null}

      {!comment.deleted ? (
        <div className="mt-1 -ml-2 flex items-center gap-1 text-caption text-faint">
          <LikeButton
            compact
            targetType="comment"
            targetId={comment.id ?? ''}
            count={comment.likeCount ?? 0}
            states={states.data}
          />
          {authed ? (
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className={ACTION_CLASS}
              data-testid="btn-reply-to-reply"
            >
              回复
            </button>
          ) : null}
          {isMine ? (
            <button
              type="button"
              onClick={() => del.mutate(comment.id ?? '')}
              disabled={del.isPending}
              className={ACTION_CLASS}
              data-testid="btn-delete-reply"
            >
              删除
            </button>
          ) : null}
        </div>
      ) : null}

      {replying ? (
        <div className="mt-2">
          <CommentComposer
            postId={postId}
            replyTo={comment.id ?? ''}
            autoFocus
            onDone={() => setReplying(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
