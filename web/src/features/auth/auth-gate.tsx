import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from '@/features/auth/session'
import { AuroraBackdrop } from '@/shared/ui/aurora-backdrop'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Card, CardDescription } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status)
  const bootstrap = useSession((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  if (status === 'unknown') {
    return (
      <div
        className="relative flex min-h-dvh flex-col items-center justify-center gap-4 px-6"
        data-testid="auth-bootstrapping"
        data-bootstrapping="true"
      >
        <AuroraBackdrop />
        <BrandMark size={48} className="animate-pulse" />
        <div className="space-y-2 text-center">
          <Skeleton className="mx-auto h-3 w-36" />
          <p className="text-xs font-medium text-muted-foreground">正在同步极光会话状态…</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

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

export function ErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-danger/40">
      <CardDescription className="text-danger">{message}</CardDescription>
    </Card>
  )
}
