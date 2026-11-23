import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Bell,
  Compass,
  Flame,
  Layers,
  LogIn,
  Moon,
  Palette,
  Search,
  Sparkles,
  Sun,
  User,
  Users,
} from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useMyCommunities, useCommunityList } from '@/features/community/api'
import { useMessageStream, useUnread } from '@/features/notification/api'
import type { LiveSseEvent, MessageType } from '@/features/notification/api'
import { LiveMessageToast, MessageDrawer } from '@/features/notification/message-drawer'
import { CommandPalette } from '@/features/search/command-palette'
import { TopbarSearch } from '@/features/search/topbar-search'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { useTheme } from '@/shared/theme/theme-store'
import { ThemeStudioSheet } from '@/shared/theme/theme-studio'
import { AuroraBackdrop } from '@/shared/ui/aurora-backdrop'
import { Avatar } from '@/shared/ui/avatar'
import { BrandMark } from '@/shared/ui/brand-mark'
import { cn } from '@/shared/lib/cn'

const PRIMARY_NAV = [
  { to: '/', label: '发现画廊', icon: Compass, end: true },
  { to: '/hot', label: '极光热榜', icon: Flame, end: false },
  { to: '/following', label: '关注动态', icon: Users, end: false },
  { to: '/c', label: '社群空间', icon: Layers, end: false },
  { to: '/search', label: '全站搜索', icon: Search, end: false, testId: 'nav-search' },
] as const

export function RootLayout() {
  const location = useLocation()
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const mode = useTheme((s) => s.mode)
  const toggleMode = useTheme((s) => s.toggleMode)
  const preset = useTheme((s) => s.preset)
  const followCommunity = useTheme((s) => s.followCommunity)
  const activeCommunity = useTheme((s) => s.activeCommunity)
  const activeChroma = useTheme((s) => s.chroma)
  const setActiveCommunity = useTheme((s) => s.setActiveCommunity)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<MessageType | undefined>(undefined)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [liveToast, setLiveToast] = useState<LiveSseEvent | null>(null)

  // 根据当前路由自动同步社群动态极光色系
  useEffect(() => {
    const m = /^\/c\/([^/]+)/.exec(location.pathname)
    if (m?.[1]) {
      try {
        setActiveCommunity(decodeURIComponent(m[1]))
      } catch {
        setActiveCommunity(m[1])
      }
    } else {
      setActiveCommunity(null)
    }
  }, [location.pathname, setActiveCommunity])

  // 全局 ⌘K / Ctrl+K 唤起琉璃搜索命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 实时 SSE 推送事件 → 弹出流光 Toast（5 秒自动消散）
  const handleLiveEvent = useCallback((ev: LiveSseEvent) => {
    setLiveToast(ev)
  }, [])

  useEffect(() => {
    if (!liveToast) return
    const t = window.setTimeout(() => setLiveToast(null), 5000)
    return () => window.clearTimeout(t)
  }, [liveToast])

  const { connected: sseConnected } = useMessageStream(handleLiveEvent)
  const { data: unread } = useUnread()
  const totalUnread = unread?.total ?? 0

  const isAuth = status === 'authenticated'
  const { data: myComms } = useMyCommunities(isAuth)
  const { data: allComms } = useCommunityList(null)

  const railCommunities = useMemo(() => {
    if (isAuth && myComms?.items && myComms.items.length > 0) {
      return myComms.items.slice(0, 8)
    }
    return (allComms?.items ?? []).slice(0, 6)
  }, [isAuth, myComms, allComms])

  return (
    <div className="relative min-h-dvh text-foreground">
      <AuroraBackdrop />

      {/* 左侧桌面端悬浮琉璃导航轨 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col p-3.5 lg:flex">
        <div className="glass-panel flex h-full flex-col justify-between rounded-3xl p-3.5">
          <div className="space-y-5 overflow-y-auto pr-0.5">
            {/* 品牌头 */}
            <Link
              to="/"
              className="group flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
            >
              <BrandMark size={36} />
              <div className="min-w-0">
                <div className="font-display text-lg font-extrabold tracking-tight text-aurora">
                  kuaikan
                </div>
                <div className="truncate text-[11px] font-medium text-muted-foreground">
                  极光社群讨论空间
                </div>
              </div>
            </Link>

            {/* 主导航 */}
            <nav aria-label="主导航" className="space-y-1">
              {PRIMARY_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  data-testid={'testId' in item ? item.testId : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? ''
                        : 'text-secondary-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground',
                    )
                  }
                  style={({ isActive }) =>
                    isActive ? { color: 'var(--btn-fg, #ffffff)' } : undefined
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="desktop-rail-pill"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                          className="absolute inset-0 -z-10 rounded-2xl shadow-lg"
                          style={{
                            background: 'var(--accent-gradient)',
                            boxShadow: '0 8px 22px -6px rgba(var(--accent-rgb), 0.55)',
                          }}
                        />
                      )}
                      <item.icon className={cn('h-4 w-4 shrink-0', isActive ? '' : 'text-primary/80')} />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            {/* 社群极光快捷轨 */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between px-2.5">
                <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                  {isAuth && myComms?.items?.length ? '我的社群' : '探索社群'}
                </span>
                <span className="inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--aurora-2)' }} />
              </div>

              <div className="space-y-1">
                {railCommunities.map((c) => {
                  const name = c.name ?? ''
                  const chroma = getCommunityChroma(name)
                  const isCurrent = activeCommunity === name
                  return (
                    <Link
                      key={c.id}
                      to={`/c/${encodeURIComponent(name)}`}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition-all',
                        isCurrent
                          ? 'bg-[var(--color-primary-soft)] text-foreground shadow-sm'
                          : 'text-secondary-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground',
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full transition-transform group-hover:scale-125"
                        style={{
                          background: chroma.gradient,
                          boxShadow: isCurrent ? `0 0 10px ${chroma.darkPrimary}` : undefined,
                        }}
                      />
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums ml-auto text-[10px] text-muted-foreground">
                        {String(c.memberCount ?? 0)}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 底部配色工作室、明暗切换与探针入口 */}
          <div className="space-y-2 border-t border-[var(--border-glass)] pt-3">
            <button
              type="button"
              data-testid="btn-theme-studio"
              onClick={() => setThemeOpen(true)}
              className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-2 text-xs font-semibold text-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.5)] hover:bg-[var(--bg-surface-hover)]"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Palette className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{preset.name}</span>
              </span>
              <span className="flex shrink-0 items-center -space-x-1">
                {preset.swatches.map((hex, i) => (
                  <span
                    key={i}
                    className="h-3 w-3 rounded-full ring-1 ring-[var(--bg-canvas)]"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </span>
            </button>

            <button
              type="button"
              onClick={toggleMode}
              className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={mode}
                    initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
                    animate={{ rotate: 0, opacity: 1, scale: 1 }}
                    exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.2 }}
                    className="inline-flex"
                  >
                    {mode === 'dark' ? (
                      <Moon className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Sun className="h-3.5 w-3.5 text-warning" />
                    )}
                  </motion.span>
                </AnimatePresence>
                <span>{mode === 'dark' ? '深色模式' : '亮色模式'}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">切换</span>
            </button>

            <Link
              to="/test"
              className="flex items-center justify-between rounded-xl px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-success" />
                微服务诊断台
              </span>
              <span className="font-mono text-[10px] opacity-70">/test</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* 右侧主区域（悬浮胶囊顶栏 + 画布） */}
      <div className="flex min-h-dvh flex-col lg:pl-[236px]">
        <header className="sticky top-0 z-20 px-3 pt-3 sm:px-5 lg:px-7">
          <div className="glass-panel mx-auto flex max-w-[1360px] items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 sm:px-4">
            {/* 移动端品牌 / 桌面端当前社群极光指示器 */}
            <div className="flex items-center gap-2.5">
              <Link to="/" className="flex items-center gap-2 lg:hidden">
                <BrandMark size={30} />
                <span className="font-display text-base font-extrabold text-aurora">kuaikan</span>
              </Link>

              {activeCommunity && followCommunity ? (
                <Link
                  to={`/c/${encodeURIComponent(activeCommunity)}`}
                  className="hidden items-center gap-2 rounded-full border border-[rgba(var(--accent-rgb),0.35)] bg-[var(--color-primary-soft)] px-3 py-1 text-xs font-semibold text-foreground lg:inline-flex"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: activeChroma.gradient }}
                  />
                  <span>#{activeCommunity}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setThemeOpen(true)}
                  className="hidden cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground lg:inline-flex"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>{preset.name}</span>
                </button>
              )}
            </div>

            {/* 中央搜索胶囊 */}
            <div className="flex flex-1 justify-center">
              <TopbarSearch onOpenPalette={() => setPaletteOpen(true)} />
            </div>

            {/* 右侧操作簇 */}
            <div className="flex shrink-0 items-center gap-2">
              {/* 顶栏快捷配色工作室入口 */}
              <button
                type="button"
                onClick={() => setThemeOpen(true)}
                aria-label="切换配色风格"
                title="配色风格工作室"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-primary"
              >
                <Palette className="h-4 w-4" />
              </button>

              {/* 移动端主题切换 */}
              <button
                type="button"
                onClick={toggleMode}
                aria-label="切换深浅主题"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground lg:hidden"
              >
                {mode === 'dark' ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-warning" />}
              </button>

              {isAuth && user ? (
                <>
                  {/* 实时消息铃铛 */}
                  <button
                    type="button"
                    data-testid="nav-messages"
                    onClick={() => {
                      setDrawerTab(undefined)
                      setDrawerOpen(true)
                    }}
                    aria-label="消息中心"
                    className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.5)] hover:text-foreground"
                  >
                    <Bell className="h-4 w-4" />
                    {sseConnected && totalUnread === 0 && (
                      <span
                        title="实时推送在线"
                        className="absolute right-1.5 bottom-1.5 h-1.5 w-1.5 rounded-full bg-success"
                      />
                    )}
                    {totalUnread > 0 && (
                      <span
                        data-testid="nav-unread"
                        className="tabular-nums absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-md"
                        style={{
                          background: 'linear-gradient(135deg, #FB7185, #F43F5E)',
                          boxShadow: '0 0 12px rgba(251, 113, 133, 0.7)',
                        }}
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </button>

                  {/* 个人中心入口 */}
                  <Link
                    to="/me"
                    data-testid="nav-user"
                    className="flex items-center gap-2 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] py-1 pr-3 pl-1 transition-all hover:border-[rgba(var(--accent-rgb),0.5)] hover:bg-[var(--bg-surface-hover)]"
                  >
                    <Avatar name={user.nickname} src={user.avatarUrl} size="sm" />
                    <span
                      data-testid="nav-nickname"
                      className="hidden max-w-[110px] truncate text-xs font-semibold text-foreground sm:inline"
                    >
                      {user.nickname}
                    </span>
                  </Link>
                </>
              ) : (
                <Link
                  to="/login"
                  data-testid="nav-login"
                  className="btn-aurora inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>登录</span>
                </Link>
              )}
            </div>
          </div>
        </header>

        {/* 主画布 */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-3 pt-5 pb-24 sm:px-5 lg:px-7 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* 移动端底部悬浮琉璃 Dock */}
      <nav
        aria-label="移动导航"
        data-testid="tabbar"
        className="fixed inset-x-3 bottom-3 z-30 lg:hidden"
      >
        <div className="glass-panel-strong mx-auto grid max-w-md grid-cols-5 items-center rounded-3xl p-1.5">
          {[
            { to: '/', label: '发现', icon: Compass, end: true },
            { to: '/hot', label: '热榜', icon: Flame, end: false },
            { to: '/following', label: '关注', icon: Users, end: false },
            { to: '/c', label: '社群', icon: Layers, end: false },
            { to: isAuth ? '/me' : '/login', label: isAuth ? '我的' : '登录', icon: User, end: false },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-col items-center justify-center gap-0.5 rounded-2xl py-2 text-[10px] font-semibold transition-colors',
                  isActive ? '' : 'text-muted-foreground',
                )
              }
              style={({ isActive }) =>
                isActive ? { color: 'var(--btn-fg, #ffffff)' } : undefined
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="mobile-dock-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 -z-10 rounded-2xl shadow-md"
                      style={{
                        background: 'var(--accent-gradient)',
                      }}
                    />
                  )}
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* 实时消息抽屉 + 右上角流光 Toast + ⌘K 命令面板 + 配色风格工作室 */}
      <MessageDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialTab={drawerTab}
        sseConnected={sseConnected}
      />
      <LiveMessageToast
        event={liveToast}
        onDismiss={() => setLiveToast(null)}
        onOpenDrawer={(tab) => {
          setDrawerTab(tab)
          setDrawerOpen(true)
        }}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ThemeStudioSheet open={themeOpen} onClose={() => setThemeOpen(false)} />
    </div>
  )
}
