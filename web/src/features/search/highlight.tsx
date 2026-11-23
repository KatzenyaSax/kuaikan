/** 后端用 Unicode 私用区字符包裹命中词（p6-search.md §5.1），**不在响应里输出 HTML** */
const OPEN = '\uE000'
const CLOSE = '\uE001'

const MARK_CLASS =
  'rounded-[3px] bg-[var(--color-primary-soft)] px-[2px] font-medium text-foreground'

/**
 * 高亮渲染器。
 *
 * 后端把命中词包成 `\uE000命中词\uE001`，前端**按占位符切片**成纯文本节点与
 * `<mark>` 元素，全程只用 React 的文本转义 —— **绝不使用 dangerouslySetInnerHTML**。
 * 这样即使帖子正文里有 `<img onerror=...>`，它也只是被当成普通字符画出来。
 *
 * 落单的占位符（理论上不会出现）一律丢掉，而不是原样显示：
 * 一个不可见字符漏到页面上，用户看到的是"句子中间莫名多了个空格"。
 */
export function HighlightedText({
  text,
  className,
}: {
  text?: string | undefined
  className?: string
}) {
  if (!text) return null

  const nodes: Array<string | ReturnType<typeof mark>> = []
  let cursor = 0

  while (cursor < text.length) {
    const open = text.indexOf(OPEN, cursor)
    const close = open < 0 ? -1 : text.indexOf(CLOSE, open + 1)

    if (open < 0 || close < 0) {
      // 没有（或只剩半截）占位符：余下部分全是纯文本
      nodes.push(strip(text.slice(cursor)))
      break
    }
    if (open > cursor) nodes.push(strip(text.slice(cursor, open)))
    nodes.push(mark(text.slice(open + 1, close), open))
    cursor = close + 1
  }

  return <span className={className}>{nodes}</span>
}

function strip(s: string): string {
  return s.replace(/[\uE000\uE001]/g, '')
}

function mark(content: string, key: number) {
  return (
    <mark key={`m${String(key)}`} className={MARK_CLASS}>
      {content}
    </mark>
  )
}
