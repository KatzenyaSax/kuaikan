import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'

/**
 * 悬浮顶栏搜索胶囊：
 * - 保留 data-testid="topbar-search-input"，直接键入并回车即跳 /search?q=...
 * - 右侧附带 ⌘K 按钮，点击唤起全站琉璃命令面板。
 */
export function TopbarSearch({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = value.trim()
    if (!q) {
      onOpenPalette?.()
      return
    }
    void navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="group relative flex w-full max-w-md items-center rounded-2xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-3.5 py-1.5 transition-all duration-200 focus-within:border-[rgba(var(--accent-rgb),0.65)] focus-within:ring-2 focus-within:ring-[var(--ring-glow)]"
    >
      <Search className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索帖子、话题或社群…"
        data-testid="topbar-search-input"
        aria-label="全站搜索"
        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
      />
      {onOpenPalette && (
        <button
          type="button"
          onClick={onOpenPalette}
          title="打开 ⌘K 命令搜索面板"
          className="ml-2 hidden shrink-0 cursor-pointer items-center gap-0.5 rounded-lg border border-[var(--border-glass-strong)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground sm:inline-flex"
        >
          ⌘K
        </button>
      )}
    </form>
  )
}
