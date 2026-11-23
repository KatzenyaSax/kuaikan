import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { useInteractionStates } from '@/features/interaction/api'
import { FavoriteButton, LikeButton } from '@/features/interaction/interaction-buttons'
import { usePostDetail } from '@/features/content/api'
import { PostContent } from '@/features/content/post-content'
import { CommentSection } from '@/features/content/comment-section'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { buttonClass } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'

/**
 * 帖子详情（右栏）。
 *
 * 排版结构固定为：面包屑 → 标题 → 作者元信息行（hairline 收口）→ 正文 →
 * 互动条（hairline 上方分隔）→ 评论区。
 *
 * **全页没有卡片**：分区靠 1px hairline 和留白。卡片多了立刻显廉价。
 *
 * 栏宽 680：S2 把社群双栏收窄到 980（左栏 272），右栏实际可用约 708——
 * 这里不再用 40rem，用 680 留出两侧呼吸空间。
 */
export function PostPage() {
  const { name, postId } = useParams<{ name: string; postId: string }>()
  const post = usePostDetail(postId)
  const community = useCommunityDetail(name)
  const status = useSession((s) => s.status)
  const targets = post.data?.id ? [`post:${post.data.id}`] : []
  const states = useInteractionStates(targets, status === 'authenticated')

  // 从消息点进来时带 ?comment=<id>，要滚到那条评论并高亮一下。
  // 评论是分页加载的，可能还没到——所以用轮询尝试有限次数，
  // 而不是"加载完立刻找一次"然后放弃。
  useScrollToComment(postId)

  if (post.isPending) {
    return (
      <div className="px-6 pb-24 pt-8 md:px-9">
        <div className="mx-auto max-w-[680px]">
          <Skeleton className="mb-4 h-4 w-32" />
          <Skeleton className="mb-3 h-9 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    )
  }

  if (post.isError) {
    return (
      <div className="px-6 pb-24 pt-8 md:px-9">
        <div className="mx-auto max-w-[680px]">
          <p className="m-0 text-body text-danger" data-testid="post-error">
            {authErrorMessage(post.error)}
          </p>
          <Link
            to={`/c/${encodeURIComponent(name ?? '')}`}
            className="mt-4 inline-block text-aux text-muted-foreground hover:text-foreground hover:underline"
          >
            ← 返回 {community.data?.name ?? name}
          </Link>
        </div>
      </div>
    )
  }

  const data = post.data

  return (
    <div className="px-6 pb-24 pt-8 md:px-9" data-testid="post-page">
      {/*
        阅读栏宽 680（右栏 708 − 两侧内缩）。S2 把社群双栏收窄到 980、左栏 272，
        所以右栏实际可用约 708px：这里不再用 40rem，改用 680 —— 一行约 38 个汉字，
        超过 45 字眼睛就要回头找行首。
      */}
      <div className="mx-auto max-w-[680px]">
      <div className="mb-5 flex items-center gap-2 text-aux text-faint">
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="truncate text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground"
        >
          {community.data?.name ?? name}
        </Link>
        <span aria-hidden>·</span>
        <span data-testid="post-time">{relativeTime(data.createdAt)}</span>
      </div>

      <PostContent post={data} communityName={name} />

      {/*
        互动条：一条 hairline 收口，下面是评论区。
        正文末尾已经不再有作者行（作者行搬到了标题下面），所以这里可以放心画 border-t。
        左右负边距抵掉 ghost 按钮的内边距，让文字和上面的正文左对齐。
      */}
      <div className="-ml-3 mt-7 flex items-center gap-1.5 border-t border-border pt-4">
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
          className={buttonClass({ variant: 'ghost', size: 'sm' })}
          data-testid="btn-share"
        >
          分享
        </button>
      </div>

      <CommentSection
        postId={data.id ?? ''}
        commentCount={data.commentCount ?? 0}
        postAuthorId={data.authorId ?? undefined}
        communityName={name}
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
