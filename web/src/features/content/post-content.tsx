import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  h1: (p) => <h2 className="mb-3.5 mt-8 text-sub font-semibold leading-[1.4]" {...p} />,
  h2: (p) => <h3 className="mb-3 mt-7 text-sub font-semibold leading-[1.4]" {...p} />,
  h3: (p) => (
    <h4 className="mb-2.5 mt-6 text-body font-semibold leading-[1.5]" {...p} />
  ),
  h4: (p) => (
    <h5 className="mb-2 mt-5 text-body font-semibold leading-[1.5]" {...p} />
  ),
  // 首段不额外加间距：标题已经给了 mb-4.5
  p: (p) => <p className="my-4 first:mt-0 last:mb-0" {...p} />,
  a: ({ href, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline decoration-[0.5px] underline-offset-2 hover:opacity-80"
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
        className="rounded-[4px] bg-surface px-1.5 py-0.5 text-[0.9em] text-foreground"
        {...rest}
      />
    ),
  // 代码块：横向滚动而不是折行——折行会破坏缩进语义
  pre: (p) => (
    <pre
      className="my-5 overflow-x-auto rounded-md bg-surface p-4 text-aux leading-[1.7]"
      {...p}
    />
  ),
  ul: (p) => <ul className="my-4 list-disc pl-6 marker:text-faint" {...p} />,
  ol: (p) => <ol className="my-4 list-decimal pl-6 marker:text-faint" {...p} />,
  li: (p) => <li className="my-1.5 pl-1" {...p} />,
  // 引用：左侧 hairline 而不是粗色块，和整体克制风格一致
  blockquote: (p) => (
    <blockquote className="my-5 border-l-2 border-border-strong pl-4 text-muted-foreground" {...p} />
  ),
  hr: (p) => <hr className="my-8 border-0 border-t border-border" {...p} />,
  // GFM 表格
  table: (p) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-aux" {...p} />
    </div>
  ),
  th: (p) => (
    <th className="border-b border-border-strong px-3 py-2 text-left font-semibold" {...p} />
  ),
  td: (p) => <td className="border-b border-border px-3 py-2" {...p} />,
  img: ({ alt, ...rest }) => (
    <img alt={alt ?? ''} className="my-5 max-w-full rounded-md" loading="lazy" {...rest} />
  ),
}

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
        className="break-words text-read leading-[1.8] text-[#1a1a1a]"
        data-testid="post-body"
      >
        <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {post.body ?? ''}
        </Markdown>
      </div>
    </article>
  )
}
