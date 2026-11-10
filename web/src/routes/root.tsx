import { NavLink, Outlet, ScrollRestoration } from 'react-router'

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-4">
          <NavLink to="/" className="text-sm font-semibold tracking-[0.14em]">
            kuaikan
          </NavLink>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            P0.5
          </span>
          <a
            href="/test/"
            className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            /test/ 冒烟控制台 →
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-5 text-[11px] text-muted-foreground">
          kuaikan · P0.5 前端基础设施 · 尚未接入业务
        </div>
      </footer>

      <ScrollRestoration />
    </div>
  )
}
