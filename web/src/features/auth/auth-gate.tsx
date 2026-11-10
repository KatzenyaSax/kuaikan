import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from '@/features/auth/session'
import { Card, CardDescription } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 启动时静默续期。
 *
 * httpOnly 的 refresh cookie 让前端无法同步判断登录态，所以**任何一次刷新页面**
 * 都必须先问一次服务端。这段时间必须渲染明确的加载态，否则会先闪一下登录页。
 */
export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status)
  const bootstrap = useSession((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  if (status === 'unknown') {
    return (
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24"
        data-testid="auth-bootstrapping"
        data-bootstrapping="true"
      >
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <p className="text-[11px] text-muted-foreground">正在确认登录状态…</p>
      </div>
    )
  }

  return <>{children}</>
}

/**
 * 三态守卫。
 *
 * unknown → 加载态（不能当成未登录，否则每次刷新都会闪一下登录页）
 * anonymous → 跳登录并记住来源
 * authenticated → 放行
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status)
  const location = useLocation()

  if (status === 'unknown') {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center" data-testid="auth-bootstrapping">
        <Skeleton className="mx-auto h-4 w-32" />
      </div>
    )
  }

  if (status === 'anonymous') {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }

  return <>{children}</>
}

/** 页面内的错误提示条 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-danger/40">
      <CardDescription className="text-danger" >{message}</CardDescription>
    </Card>
  )
}
