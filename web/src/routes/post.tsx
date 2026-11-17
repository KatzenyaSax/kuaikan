import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
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
import { buttonClass } from '@/shared/ui/button'
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

  // 从消息点进来时带 ?comment=<id>，要滚到那条评论并高亮一下。
  // 评论是分页加载的，可能还没到——所以用轮询尝试有限次数，
  // 而不是"加载完立刻找一次"然后放弃。
  useScrollToComment(postId)

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

      {/*
        这里**不能**再画一条 border-t：上面的作者行已经用 border-y 收口了，
        两条 hairline 之间只隔 24px，看起来像"多出一条线"（确实被这么报过）。
        左右负边距抵掉 ghost 按钮的内边距，让文字和上面的作者名左对齐。
      */}
      <div className="-ml-2.5 mt-3 flex items-center gap-0.5">
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
          className={buttonClass({ variant: 'ghost', size: 'sm', className: 'px-2.5' })}
          data-testid="btn-share"
        >
          分享
        </button>
      </div>

      <CommentSection
        postId={data.id ?? ''}
        commentCount={data.commentCount ?? 0}
        postAuthorId={data.authorId ?? undefined}
      />
      </div>
    </div>
  )
}

/**
 * 从消息跳进来时滚到对应评论。
 *
 * 两个现实约束：
 * 1. 评论是游标分页的，目标可能在第二页——所以查不到就继续等，最多约 3 秒
 * 2. 目标若是**回复**，它藏在「展开 N 条回复」里，用户没点开就找不到。
 *    这种情况退化为"停在帖子页"，不自动展开——自动展开别人没要求的回复
 *    比不滚过去更打扰。
 *
 * 高亮用 2 秒后自动淡出的背景，是为了回答"我到底跳到了哪一条"，
 * 而不是长期把某条评论标成特殊状态。
 */
function useScrollToComment(postId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams()
  const target = searchParams.get('comment')
  const root = searchParams.get('root')

  useEffect(() => {
    if (!target || !postId) return
    let tries = 0
    let expanded = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // 用完就摘掉参数：刷新或分享链接时不该一直高亮、也不该一直被当成"跳转请求"
    const clear = () => {
      const next = new URLSearchParams(searchParams)
      next.delete('comment')
      next.delete('root')
      setSearchParams(next, { replace: true })
    }

    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-comment-anchor="${CSS.escape(target)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.dataset.highlighted = 'true'
        setTimeout(() => { delete el.dataset.highlighted }, 2000)
        clear()
        return
      }
      // 目标可能在折叠的回复里：先点开它的 root，再继续找
      if (!expanded && root) {
        const btn = document.querySelector<HTMLElement>(`[data-expand-root="${CSS.escape(root)}"]`)
        if (btn) {
          btn.click()
          expanded = true
        }
      }
      tries += 1
      if (tries < 20) {
        timer = setTimeout(tick, 200)
      } else {
        // 找不到就停在帖子页，但参数要摘掉——否则地址栏会一直挂着一个无效锚点
        clear()
      }
    }
    tick()
    return () => { if (timer) clearTimeout(timer) }
    // searchParams/setSearchParams 是稳定引用，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, root, postId])
}
