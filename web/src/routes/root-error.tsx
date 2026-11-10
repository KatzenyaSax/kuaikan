import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

export function RootErrorBoundary() {
  const error = useRouteError()

  const detail = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误'

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <Card className="space-y-3">
        <CardTitle>页面出错了</CardTitle>
        <CardDescription>
          ErrorBoundary 兜住了渲染期异常，用户不会看到白屏。
        </CardDescription>
        <pre className="mt-2 overflow-auto rounded border border-border bg-muted p-3 text-[11px] text-danger">
          {detail}
        </pre>
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={() => window.location.assign('/')}>
            回到首页
          </Button>
        </div>
      </Card>
    </div>
  )
}
