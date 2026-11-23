import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { AuroraBackdrop } from '@/shared/ui/aurora-backdrop'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'

export function RootErrorBoundary() {
  const err = useRouteError()
  const message = isRouteErrorResponse(err)
    ? `${String(err.status)} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : '页面渲染时发生未知异常'

  return (
    <div className="relative flex min-h-dvh items-center justify-center p-6 text-foreground">
      <AuroraBackdrop />
      <Card padding="lg" strong className="w-full max-w-md rounded-3xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-danger-soft)] text-danger">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="font-display text-xl font-extrabold text-foreground">页面遇到了一点波动</h1>
        <p className="mt-2 rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-2 font-mono text-xs text-muted-foreground">
          {message}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RotateCcw className="h-4 w-4" />
            刷新页面
          </Button>
          <Link
            to="/"
            className="btn-aurora inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold"
          >
            返回首页
          </Link>
        </div>
      </Card>
    </div>
  )
}
