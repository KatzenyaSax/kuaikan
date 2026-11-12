import type { PostDetail } from '@/features/content/api'

/**
 * 帖子正文。
 *
 * **刻意独立成组件**：P2.3 的单栏详情页和 P2.4 双栏的右栏共用它，
 * 以后者为例，P2.4 只换外层容器，这里一行都不用改。
 *
 * 正文是纯文本 + `whitespace-pre-wrap` 渲染：
 *   - 不做 Markdown（要引入解析器 + 消毒，是全新的 XSS 面）
 *   - 不用 dangerouslySetInnerHTML（React 默认转义，天然安全）
 */
export function PostContent({ post }: { post: PostDetail }) {
  return (
    <article className="space-y-3">
      <h1 className="text-lg font-semibold leading-snug" data-testid="post-title">
        {post.title}
      </h1>
      <div
        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
        data-testid="post-body"
      >
        {post.body}
      </div>
    </article>
  )
}
