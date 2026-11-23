const OPEN = '\uE000'
const CLOSE = '\uE001'

const MARK_CLASS =
  'rounded-md border border-[rgba(var(--accent-rgb),0.35)] bg-[var(--color-primary-soft)] px-1 py-0.5 font-semibold text-foreground'

/**
 * 安全高亮渲染器：按后端 `\uE000...\uE001` 切片为纯 React 节点，绝不使用 dangerouslySetInnerHTML。
 */
export function HighlightedText({
  text,
  className,
  stripMarkdown = false,
}: {
  text?: string | undefined
  className?: string
  stripMarkdown?: boolean
}) {
  if (!text) return null

  const source = stripMarkdown
    ? text
        .replace(/(^|\s)#{1,6}\s+/g, '$1')
        .replace(/\*\*|__|~~|`/g, '')
        .replace(/\s+/g, ' ')
    : text

  const nodes: Array<string | ReturnType<typeof mark>> = []
  let cursor = 0

  while (cursor < source.length) {
    const open = source.indexOf(OPEN, cursor)
    const close = open < 0 ? -1 : source.indexOf(CLOSE, open + 1)

    if (open < 0 || close < 0) {
      nodes.push(strip(source.slice(cursor)))
      break
    }
    if (open > cursor) nodes.push(strip(source.slice(cursor, open)))
    nodes.push(mark(source.slice(open + 1, close), open))
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
