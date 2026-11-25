import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink } from 'lucide-react'

export type CitationItem = {
  n: number
  postId: string
  title: string
  communityName: string
  authorNickname: string
}

/**
 * 剥离不在白名单内的角标 [^k]，避免模型幻觉留下无效角标；
 * 若处于流式输出末尾（尚未闭合），保留白名单外完整角标的剥离仅对已闭合模式生效。
 */
export function sanitizeCitationsText(text: string, citations: readonly CitationItem[]): string {
  if (!text) return ''
  const validSet = new Set(citations.map((c) => c.n))
  return text.replace(/\[\^(\d+)\]/g, (_full, numStr: string) => {
    const num = Number(numStr)
    return validSet.has(num) ? `[#${numStr}]` : ''
  })
}

export function CitationAnswer({
  content,
  citations,
  streaming,
}: {
  content: string
  citations: readonly CitationItem[]
  streaming?: boolean | undefined
}) {
  // 流式未结束前暂不剥离未知角标（citations 在流尾才到达），流结束后严格按白名单剥离
  const rendered = streaming ? content : sanitizeCitationsText(content, citations)

  return (
    <div className="space-y-2.5">
      <div className="prose-aurora text-sm leading-relaxed break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{rendered}</ReactMarkdown>
      </div>

      {citations.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-semibold text-muted-foreground">站内引用</div>
          <div className="grid gap-1.5">
            {citations.map((c) => {
              const href = c.communityName
                ? `/c/${encodeURIComponent(c.communityName)}/p/${encodeURIComponent(c.postId)}`
                : undefined
              const inner = (
                <div className="flex items-start justify-between gap-2 rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-2 text-xs transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:bg-[var(--bg-surface-hover)]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-[var(--color-primary-soft)] px-1 font-mono text-[10px] font-bold text-primary">
                        {String(c.n)}
                      </span>
                      <span className="truncate">{c.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {c.communityName ? `#${c.communityName}` : ''}
                      {c.communityName && c.authorNickname ? ' · ' : ''}
                      {c.authorNickname}
                    </div>
                  </div>
                  {href && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </div>
              )

              return href ? (
                <Link key={`${c.postId}-${String(c.n)}`} to={href} data-testid="ai-citation-card">
                  {inner}
                </Link>
              ) : (
                <div key={`${c.postId}-${String(c.n)}`} data-testid="ai-citation-card">
                  {inner}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
