import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { streamCompose } from '@/features/ai/api'
import { Button } from '@/shared/ui/button'

type ComposeMode = 'EXPAND' | 'POLISH' | 'SHORTEN' | 'RECOMMEND_COMMUNITY' | 'REPLY'

const POST_MODES: ReadonlyArray<{ mode: ComposeMode; label: string }> = [
  { mode: 'EXPAND', label: 'AI 扩写' },
  { mode: 'POLISH', label: '润色' },
  { mode: 'SHORTEN', label: '精简' },
  { mode: 'RECOMMEND_COMMUNITY', label: '推荐社群' },
]

const REPLY_MODES: ReadonlyArray<{ mode: ComposeMode; label: string }> = [
  { mode: 'REPLY', label: 'AI 帮写回复' },
  { mode: 'POLISH', label: '润色' },
  { mode: 'SHORTEN', label: '精简' },
]

export function AiComposeBar({
  variant,
  draft,
  postId,
  onReplace,
  onInsert,
}: {
  variant: 'post' | 'reply'
  draft: string
  postId?: string | undefined
  onReplace: (text: string) => void
  onInsert: (text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const run = async (mode: ComposeMode) => {
    if (busy) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setBusy(true)
    setError(null)
    setPreview('')

    try {
      await streamCompose(
        {
          mode,
          draft: draft.trim(),
          ...(postId ? { postId } : {}),
        },
        {
          onDelta: (text) => setPreview((prev) => (prev ?? '') + text),
          onError: (_code, msg) => setError(msg),
        },
        controller.signal,
      )
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '生成失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const options = variant === 'post' ? POST_MODES : REPLY_MODES

  return (
    <div className="space-y-2" data-testid={`ai-compose-bar-${variant}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
          <Sparkles className="h-3 w-3" />
          AI 帮写
        </span>
        {options.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            disabled={busy}
            data-testid={`btn-ai-compose-${opt.mode.toLowerCase()}`}
            onClick={() => void run(opt.mode)}
            className="cursor-pointer rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground disabled:opacity-50"
          >
            {opt.label}
          </button>
        ))}
      </div>

      {(preview !== null || error) && (
        <div
          data-testid="ai-compose-preview"
          className="space-y-2 rounded-2xl border border-[rgba(var(--accent-rgb),0.3)] bg-[var(--bg-input)] p-3 text-xs"
        >
          {busy && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在生成建议…
            </div>
          )}
          {preview && (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground">
              {preview}
            </div>
          )}
          {error && <p className="text-danger">{error}</p>}
          {!busy && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {preview && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="ai-compose-insert"
                    onClick={() => {
                      onInsert(preview)
                      setPreview(null)
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    插入
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    data-testid="ai-compose-replace"
                    onClick={() => {
                      onReplace(preview)
                      setPreview(null)
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    替换
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="ai-compose-discard"
                onClick={() => {
                  setPreview(null)
                  setError(null)
                }}
              >
                <X className="h-3.5 w-3.5" />
                放弃
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
