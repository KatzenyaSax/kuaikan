import { useState } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useMatch, useNavigate } from 'react-router'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Toaster } from '@/shared/ui/toast'
import { cn } from '@/shared/lib/cn'

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/c', label: '社群', end: false },
  { to: '/following', label: '关注', end: false },
  { to: '/hot', label: '热榜', end: false },
] as const

/**
 * 应用外壳：顶栏 + 内容 + 底部 tab（窄屏）。
 *
 * 导航结构：
 *   左：品牌 + 主导航（首页 / 社群 / 关注 / 热榜 / 搜索）
 *   右：消息（带未读数）+ 头像昵称
 *
 * **「我的」不占顶栏位置** —— 点昵称进入。顶栏是最贵的位置，
 * 只留给需要"随时可达"的东西：切换场景（主导航）、看消息、确认身份。
 *
 * 搜索是全屏覆盖层而不是页面：搜索是瞬时任务，不该丢掉当前上下文。
 * 消息是右侧抽屉：读帖子时"瞥一眼消息"是轻任务。
 */
export function RootLayout() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [msgOpen, setMsgOpen] = useState(false)
  const authed = status === 'authenticated'
  // 双栏阅读页占满视口高度，页脚会让页面多出一条"为看页脚而滚"的细滚动条。
  // useMatch 必须在顶层无条件调用，不能写在条件里（hooks 顺序要稳定）。
  const communityMatch = useMatch('/c/:name/*')
  const inTwoPane = communityMatch !== null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 h-[var(--topbar-h)] border-b border-border bg-[rgba(255,255,255,0.72)] backdrop-blur-[20px] backdrop-saturate-[180%]">
        <div className="mx-auto flex h-full w-full max-w-[1200px] items-center gap-7 px-6">
          <Link to="/" className="shrink-0 text-body font-semibold tracking-[0.08em]">
            kuaikan
          </Link>

          {/* 主导航：不用图标，靠字重与颜色表达当前项 */}
          <nav className="hidden items-center gap-5.5 md:flex" aria-label="主导航">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'text-aux transition-colors duration-[150ms]',
                    isActive
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="text-aux text-muted-foreground transition-colors duration-[150ms] hover:text-foreground"
              data-testid="nav-search"
            >
              搜索
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-4.5">
            <button
              type="button"
              onClick={() => setMsgOpen(true)}
              className="relative text-aux text-muted-foreground transition-colors duration-[150ms] hover:text-foreground"
              data-testid="nav-messages"
            >
              消息
              {/* 未读徽标：全站唯一的红点，所以它一定意味着"有事情" */}
              <span
                className="absolute -right-2.5 -top-[3px] min-w-[15px] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[15px] text-white"
                data-testid="nav-unread"
              >
                3
              </span>
            </button>

            {authed && user ? (
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="flex items-center gap-2 text-aux text-muted-foreground transition-colors duration-[150ms] hover:text-foreground"
                data-testid="nav-user"
                title="我的"
              >
                <Avatar url={user.avatarUrl} name={user.nickname} size={24} />
                <span className="hidden max-w-[8em] truncate md:inline" data-testid="nav-nickname">
                  {user.nickname}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-aux text-muted-foreground transition-colors duration-[150ms] hover:text-foreground"
                data-testid="nav-login"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer
        className={cn(
          'border-t border-border pb-[var(--tabbar-h)] md:pb-0',
          inTwoPane && 'hidden md:block',
        )}
      >
        <div className="mx-auto w-full max-w-[1200px] px-6 py-5 text-caption text-faint">
          kuaikan · 一个以社群为单位的讨论社区
        </div>
      </footer>

      {/* 窄屏：主导航进底部 tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-45 border-t border-border bg-[rgba(255,255,255,0.86)] pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-[20px] backdrop-saturate-[180%] md:hidden"
        aria-label="底部导航"
        data-testid="tabbar"
      >
        <div className="grid h-[var(--tabbar-h)] grid-cols-5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-caption',
                  isActive ? 'font-semibold text-foreground' : 'text-faint',
                )
              }
            >
              {n.label}
              <span className="h-[3px] w-[3px] rounded-full bg-current opacity-0 [.font-semibold_&]:opacity-100 aria-[current=page]:opacity-100" />
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-caption text-faint"
          >
            搜索
            <span className="h-[3px] w-[3px] rounded-full bg-current opacity-0" />
          </button>
        </div>
      </nav>

      <SearchLayer open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MessageDrawer open={msgOpen} onClose={() => setMsgOpen(false)} />

      <ScrollRestoration />
      <Toaster />
    </div>
  )
}

/**
 * 全屏搜索层。
 *
 * 搜索还没做（P6），所以这里**只定形态、给一句诚实说明**，
 * 不摆一个假的搜索结果。
 */
function SearchLayer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-background"
      style={{ animation: 'fade-in 250ms cubic-bezier(0.2,0.8,0.2,1) both' }}
      role="dialog"
      aria-modal="true"
      aria-label="搜索"
      data-testid="search-layer"
    >
      <div className="mx-auto max-w-[40rem] px-6 py-10">
        <div className="flex h-[52px] items-center gap-2.5 rounded-[var(--radius-lg)] bg-surface px-4.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索帖子、社群、用户"
            aria-label="搜索"
            className="min-w-0 flex-1 bg-transparent text-read text-foreground outline-none placeholder:text-faint"
            data-testid="search-input"
          />
          <button
            type="button"
            onClick={onClose}
            className="text-aux text-faint hover:text-foreground"
            data-testid="search-close"
          >
            取消
          </button>
        </div>
        <p className="mt-3.5 text-aux text-faint">
          {q.trim()
            ? `「${q.trim()}」—— 搜索功能在后续版本开放`
            : '搜索功能在后续版本开放。这里先定下它的位置与形态。'}
        </p>
      </div>
    </div>
  )
}

/**
 * 消息抽屉（P4）。
 *
 * 四分类与顶栏红点先定下来；内容做成空态，不摆假消息。
 */
function MessageDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState('like')
  const tabs = [
    { key: 'like', label: '赞' },
    { key: 'comment', label: '评论' },
    { key: 'mention', label: '@' },
    { key: 'system', label: '系统' },
  ]

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-50 bg-[rgba(0,0,0,0.42)] transition-opacity duration-[250ms]',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="消息"
        data-testid="message-drawer"
        className={cn(
          'fixed bottom-0 right-0 top-0 z-[55] flex w-[min(400px,100vw)] flex-col bg-background transition-transform duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-border px-5">
          <h2 className="text-sub font-semibold">消息</h2>
          <button type="button" onClick={onClose} className="text-aux text-muted-foreground">
            关闭
          </button>
        </div>
        <div className="flex shrink-0 gap-5 border-b border-border px-5" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative h-11 text-aux transition-colors duration-[150ms]',
                tab === t.key ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {t.label}
              {tab === t.key ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto px-5 pb-8">
          <div className="px-6 py-14 text-center">
            <p className="mb-2 text-body font-medium">消息中心还在建设中</p>
            <p className="text-aux text-muted-foreground">
              上线后这里按赞、评论、@、系统四类分组，
              <br />
              未读数直接显示在顶栏的红点上。
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}
