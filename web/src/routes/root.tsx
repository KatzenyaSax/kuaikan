import { NavLink, Outlet, ScrollRestoration, useNavigate } from 'react-router'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'

export function RootLayout() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-6 py-4">
          <NavLink to="/" className="text-sm font-semibold tracking-[0.14em]">
            kuaikan
          </NavLink>

          <div className="ml-auto flex items-center gap-4 text-xs">
            <NavLink to="/test" className="text-muted-foreground hover:text-foreground">
              /test
            </NavLink>
            {status === 'authenticated' && user ? (
              <span className="flex items-center gap-2" data-testid="nav-user">
                {/* 头像在昵称左边 */}
                <Avatar url={user.avatarUrl} name={user.nickname} size={22} />
                <span className="text-muted-foreground">{user.nickname}</span>
              </span>
            ) : null}
            {status === 'authenticated' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/me')}
                data-testid="nav-me"
              >
                我的
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/login')}
                data-testid="nav-login"
              >
                登录
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-6 py-5 text-[11px] text-muted-foreground">
          kuaikan · 一个以社群为单位的讨论社区
        </div>
      </footer>

      <ScrollRestoration />
    </div>
  )
}
