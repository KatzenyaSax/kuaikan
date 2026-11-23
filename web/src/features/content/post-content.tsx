import { useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useNavigate } from 'react-router'
import { pickAuthor, useDeletePost, useUserSummaries, type PostDetail } from '@/features/content/api'
import { useMyCommunityStatus } from '@/features/community/api'
import { BanMemberDialog } from '@/features/community/ban-member-dialog'
import { ConfirmDialog } from '@/features/community/dialog'
import { FollowButton } from '@/features/social/follow-button'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { relativeTime } from '@/shared/lib/time'
import { toast } from '@/shared/ui/toast'

/**
 * 帖子正文。
 *
 * **刻意独立成组件**：单栏详情页和双栏的右栏共用它，换布局时这里一行都不用改。
 *
 * 正文排版是本产品的核心，参数都是有针对性的：
 *   - 17px / 行高 1.8：中文比拉丁更需要行高，1.5 会挤
 *   - 栏宽由外层限制在 680px（约 38 个汉字/行），超过 45 字眼睛就要回头找行首
 *   - 标题 32px 档、紧字距（token 里已带 -0.015em），正文不动字距
 *
 * 层级只有三档：文章标题（title）→ 小标题（sub / read）→ 正文（read）。
 * **Markdown 标题一律降一档**（h1 → 21px）：正文里的 h1 不该和文章标题一样大，
 * 否则一篇用 `#` 开头的帖子会出现两个同样大的标题。
 *
 * ## 为什么用 react-markdown 而不是手写解析器
 *
 * 手写 Markdown 是经典的 bug 温床（嵌套列表、代码块里的反引号、转义……）。
 * 但引入解析器的真正风险不是解析，是 **XSS**。
 *
 * 这里的安全边界：**没有启用 rehype-raw**。react-markdown 默认把 HTML 当纯文本，
 * 不解析成 DOM 节点，所以 `<img onerror=...>`、`<script>` 只会原样显示成文字。
 * 一旦有人加上 rehype-raw，这个结论立刻失效——那时必须配 rehype-sanitize，
 * 而且要重新评估白名单。**不要加。**
 *
 * 链接额外加固：`javascript:` 协议的 href 会被 react-markdown 拦掉，
 * 但外部链接仍要 `rel="noreferrer noopener"`（改 window.opener 的老套路）。
 */

/** 行内/块级样式集中在这里，正文的排版规则只有这一处。 */
const MD_COMPONENTS: Components = {
  h1: (p) => (
    <h2 className="mb-3 mt-9 text-sub font-semibold leading-[1.4] first:mt-0" {...p} />
  ),
  h2: (p) => (
    <h3 className="mb-3 mt-9 text-sub font-semibold leading-[1.4] first:mt-0" {...p} />
  ),
  h3: (p) => (
    <h4 className="mb-2 mt-7 text-read font-semibold leading-[1.5]" {...p} />
  ),
  h4: (p) => (
    <h5 className="mb-2 mt-6 text-read font-semibold leading-[1.5]" {...p} />
  ),
  // 首段不额外加间距：标题已经给了 mb-3
  p: (p) => <p className="my-4 first:mt-0 last:mb-0" {...p} />,
  a: ({ href, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline decoration-[0.5px] underline-offset-[3px] hover:text-primary-hover"
      {...rest}
    />
  ),
  strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  del: (p) => <del className="text-faint line-through" {...p} />,
  // 行内代码：和代码块视觉区分——行内是浅底、无边框
  code: ({ className, ...rest }) =>
    className ? (
      <code className={className} {...rest} />
    ) : (
      <code
        className="rounded-[5px] bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        {...rest}
      />
    ),
  // 代码块：横向滚动而不是折行——折行会破坏缩进语义
  pre: (p) => (
    <pre
      className="my-5 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface p-4 font-mono text-aux leading-[1.75]"
      {...p}
    />
  ),
  ul: (p) => <ul className="my-4 list-disc pl-6 marker:text-faint" {...p} />,
  ol: (p) => <ol className="my-4 list-decimal pl-6 marker:text-faint" {...p} />,
  li: (p) => <li className="my-1.5 pl-1" {...p} />,
  // 引用：左侧 hairline 而不是粗色块，和整体克制风格一致
  blockquote: (p) => (
    <blockquote
      className="my-6 border-l-2 border-border-strong pl-5 text-muted-foreground"
      {...p}
    />
  ),
  hr: (p) => <hr className="my-10 border-0 border-t border-border" {...p} />,
  // GFM 表格：表头不填色，靠一条深一点的 hairline
  table: (p) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-aux" {...p} />
    </div>
  ),
  th: (p) => (
    <th
      className="border-b border-border-strong px-3 py-2.5 text-left font-semibold text-foreground"
      {...p}
    />
  ),
  td: (p) => <td className="border-b border-border px-3 py-2.5" {...p} />,
  img: ({ alt, ...rest }) => (
    <img
      alt={alt ?? ''}
      className="my-6 max-w-full rounded-[var(--radius-md)]"
      loading="lazy"
      {...rest}
    />
  ),
}

export function PostContent({
  post,
  communityName,
}: {
  post: PostDetail
  /** 社群名。管理员的快捷治理入口靠它判权限（`/my-status`）*/
  communityName?: string | undefined
}) {
  // 作者摘要与帖子详情是两个请求：`authorId` 是跨服务引用（ADR 0009），
  // 后端不会在帖子 DTO 里拼昵称头像。
  const authors = useUserSummaries([post.authorId])
  const author = pickAuthor(authors.data, post.authorId)
  const authorId = post.authorId ?? undefined

  const navigate = useNavigate()
  const me = useSession((s) => s.user?.userId)
  const authed = useSession((s) => s.status) === 'authenticated'
  const myStatus = useMyCommunityStatus(communityName, authed)
  const del = useDeletePost(post.id)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [banning, setBanning] = useState(false)

  // 管理员**看别人的帖子**才有快捷治理：自己的帖子用普通删除
  // （后端两边都能过，但给作者看"封禁作者"是荒谬的）
  const canGovern = myStatus.data?.admin === true && Boolean(authorId) && authorId !== me

  return (
    <article>
      <h1 className="m-0 text-title text-pretty" data-testid="post-title">
        {post.title}
      </h1>

      {/*
        作者元信息行：标题下面、正文上面。
        读完标题第一件想知道的就是「谁写的、什么时候」——把它放在正文前，
        读者不用滚到底部去找。一条 hairline 收口，把元信息和正文分开。

        头像与昵称整体是一个链接（不是两个），点击热区才够大；
        右侧是关注按钮 —— 这是读完标题最想做的动作之一，放在作者名旁边而不是页面底部。
      */}
      <div
        className="mt-4 flex items-center gap-2.5 border-b border-border pb-5 text-aux text-muted-foreground"
        data-testid="post-author"
      >
        {author ? (
          <>
            <Link
              to={`/u/${encodeURIComponent(authorId ?? '')}`}
              className="inline-flex min-w-0 items-center gap-2.5 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
              data-testid="post-author-link"
            >
              <Avatar url={author.avatarUrl ?? null} name={author.nickname ?? ''} size={28} />
              <span className="truncate text-body font-medium text-foreground">
                {author.nickname}
              </span>
            </Link>
            <span className="text-faint">·</span>
            <span>{relativeTime(post.createdAt)}</span>
          </>
        ) : authors.isPending ? (
          // 作者摘要没回来时不要渲染“已注销用户”——那会闪一下又变，比留白更像 bug
          <span>加载作者…</span>
        ) : (
          <span data-testid="post-author-deleted">已注销用户</span>
        )}
        <div className="ml-auto shrink-0">
          <FollowButton userId={authorId} size="sm" />
        </div>
      </div>

      {/*
        管理员的快捷治理：删帖 + 封禁作者。

        放在作者行下面而不是页面底部：管理员看到违规内容时，
        想做的就是"把这个人和这条内容处理掉"，位置远了就变成"先记下来回头再说"。
        用与评论次级动作同一套小胶囊，不抢正文的视线。
      */}
      {canGovern ? (
        <div className="-ml-2 mt-2 flex items-center gap-1 text-caption text-faint">
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex h-7 items-center rounded-full px-2 transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground"
            data-testid="admin-delete-post"
          >
            删除帖子
          </button>
          <button
            type="button"
            onClick={() => setBanning(true)}
            className="inline-flex h-7 items-center rounded-full px-2 transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground"
            data-testid="admin-ban-post-author"
          >
            封禁作者
          </button>
        </div>
      ) : null}

      <div className="mt-7 break-words text-read text-foreground" data-testid="post-body">
        <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {post.body ?? ''}
        </Markdown>
      </div>

      {confirmingDelete ? (
        <ConfirmDialog
          title="删除这篇帖子？"
          description="帖子会从社群列表与搜索结果中消失，评论也会一起隐藏。这是管理员操作，作者不会收到通知。"
          confirmLabel="删除"
          danger
          busy={del.isPending}
          testId="admin-delete-post-dialog"
          confirmTestId="btn-confirm-delete-post"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            del.mutate(undefined, {
              onSuccess: () => {
                setConfirmingDelete(false)
                toast('已删除帖子')
                // 删完停在已经 404 的详情页没有意义，回社群
                navigate(`/c/${encodeURIComponent(communityName ?? '')}`)
              },
              onError: (err) => {
                setConfirmingDelete(false)
                toast(authErrorMessage(err))
              },
            })
          }}
        />
      ) : null}

      {banning && authorId ? (
        <BanMemberDialog
          communityName={communityName}
          targetUserId={authorId}
          targetNickname={author?.nickname}
          onClose={() => setBanning(false)}
        />
      ) : null}
    </article>
  )
}
