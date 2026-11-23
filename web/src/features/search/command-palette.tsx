import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Compass,
  Flame,
  Search,
  Sparkles,
  User,
  Users,
  X,
} from 'lucide-react'
import { useSearchPosts } from '@/features/search/api'
import { HighlightedText } from '@/features/search/highlight'
import { useCommunityList } from '@/features/community/api'
import { Avatar } from '@/shared/ui/avatar'
import { relativeTime } from '@/shared/lib/time'

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [rawQuery, setRawQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(rawQuery.trim()), 220)
    return () => window.clearTimeout(t)
  }, [rawQuery])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const searchQuery = useSearchPosts({
    q: open ? debounced : '',
    sort: 'relevance',
    communityId: '',
  })
  const { data: commData } = useCommunityList(null)

  const hits = (searchQuery.data?.pages[0]?.items ?? []).slice(0, 6)
  const communities = (commData?.items ?? [])
    .filter((c) => {
      if (!debounced) return true
      const q = debounced.toLowerCase()
      return (
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      )
    })
    .slice(0, 5)

  const goTo = (path: string) => {
    onClose()
    setRawQuery('')
    void navigate(path)
  }

  const submitFullSearch = () => {
    const q = rawQuery.trim()
    if (!q) return
    goTo(`/search?q=${encodeURIComponent(q)}`)
  }

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[11vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-md"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="全局命令搜索面板"
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-panel-strong relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl shadow-2xl"
          >
            {/* 顶部流光细线 */}
            <div
              className="h-[2px] w-full"
              style={{ background: 'var(--accent-gradient)' }}
            />

            {/* 搜索输入行 */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitFullSearch()
              }}
              className="flex items-center gap-3 border-b border-[var(--border-glass)] px-5 py-4"
            >
              <Search className="h-5 w-5 shrink-0 text-primary" />
              <input
                autoFocus
                type="text"
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="搜索全站帖子、社群或快速跳转…"
                className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {rawQuery && (
                <button
                  type="button"
                  onClick={() => setRawQuery('')}
                  className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <kbd className="hidden rounded-lg border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-2 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline-block">
                ESC
              </kbd>
            </form>

            {/* 内容区 */}
            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
              {/* 实时 ES 搜索命中 */}
              {debounced && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      全站帖子实时检索
                    </span>
                    <button
                      type="button"
                      onClick={submitFullSearch}
                      className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      查看全部结果 <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  {searchQuery.isPending ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      正在搜索…
                    </p>
                  ) : hits.length === 0 ? (
                    <p className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-5 text-center text-xs text-muted-foreground">
                      没有找到包含「{debounced}」的帖子
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {hits.map((item) => {
                        const cName = item.communityName ?? ''
                        const href =
                          cName && item.postId
                            ? `/c/${encodeURIComponent(cName)}/p/${encodeURIComponent(item.postId)}`
                            : `/search?q=${encodeURIComponent(debounced)}`
                        return (
                          <button
                            key={item.postId}
                            type="button"
                            onClick={() => goTo(href)}
                            className="group flex w-full cursor-pointer flex-col gap-1 rounded-2xl border border-transparent px-3.5 py-2.5 text-left transition-all hover:border-[rgba(var(--accent-rgb),0.3)] hover:bg-[var(--bg-surface-hover)]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">
                                <HighlightedText text={item.titleHighlight || item.title} />
                              </span>
                              <span className="tabular-nums shrink-0 text-[11px] text-muted-foreground">
                                {relativeTime(item.createdAt)}
                              </span>
                            </div>
                            {item.bodySnippet && (
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                <HighlightedText text={item.bodySnippet} stripMarkdown />
                              </p>
                            )}
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              {cName && <span className="font-medium text-primary">#{cName}</span>}
                              {item.authorNickname && <span>· {item.authorNickname}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 社群快速直达 */}
              {communities.length > 0 && (
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                    {debounced ? '匹配的社群' : '精选社群直达'}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {communities.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => goTo(`/c/${encodeURIComponent(c.name ?? '')}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-surface)] px-3 py-2.5 text-left transition-all hover:border-[rgba(var(--accent-rgb),0.4)] hover:bg-[var(--bg-surface-hover)]"
                      >
                        <Avatar
                          name={c.name ?? '?'}
                          src={c.avatarUrl}
                          size="sm"
                          shape="rounded"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {c.name}
                          </p>
                          <p className="tabular-nums text-[11px] text-muted-foreground">
                            {String(c.memberCount ?? 0)} 位成员
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 快捷空间跳转 */}
              {!debounced && (
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                    快速导航
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { to: '/', label: '发现首页', icon: Compass },
                      { to: '/hot', label: '极光热榜', icon: Flame },
                      { to: '/following', label: '关注动态', icon: Users },
                      { to: '/me', label: '个人中心', icon: User },
                    ].map((nav) => (
                      <button
                        key={nav.to}
                        type="button"
                        onClick={() => goTo(nav.to)}
                        className="flex cursor-pointer items-center gap-2 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-surface)] px-3 py-2.5 text-xs font-medium text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.4)] hover:text-foreground"
                      >
                        <nav.icon className="h-3.5 w-3.5 text-primary" />
                        <span>{nav.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 底部提示栏 */}
            <div className="flex items-center justify-between border-t border-[var(--border-glass)] bg-[var(--bg-input)] px-5 py-2.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                按 Enter 查看全部搜索结果
              </span>
              <span className="font-mono">ESC 关闭</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
