import type { PostDetail } from '@/features/content/api'

/**
 * 帖子正文。
 *
 * **刻意独立成组件**：单栏详情页和双栏的右栏共用它，换布局时这里一行都不用改。
 *
 * 正文排版是本产品的核心，参数都是有针对性的：
 *   - 17px / 行高 1.8：中文比拉丁更需要行高，1.5 会挤
 *   - 栏宽由外层限制在 40rem（约 37 个汉字/行），超过 45 字眼睛就要回头找行首
 *   - 标题 28px / 1.32，**中文不加负字距**（压字距会让笔画糊在一起）
 *
 * 纯文本 + `whitespace-pre-wrap`：
 *   - 不做 Markdown（要引入解析器 + 消毒，是全新的 XSS 面）
 *   - 不用 dangerouslySetInnerHTML（React 默认转义，天然安全）
 */
export function PostContent({ post }: { post: PostDetail }) {
  return (
    <article>
      <h1
        className="m-0 mb-4.5 text-title font-[640] leading-[1.32] text-foreground"
        data-testid="post-title"
      >
        {post.title}
      </h1>
      <div
        className="whitespace-pre-wrap break-words text-read leading-[1.8] text-[#1a1a1a]"
        data-testid="post-body"
      >
        {post.body}
      </div>
    </article>
  )
}
