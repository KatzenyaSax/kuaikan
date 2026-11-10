import { REFETCH_SECONDS } from '@/features/status/api'
import { ServiceStatusGrid } from '@/features/status/service-status-grid'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

export function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-wide">kuaikan</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          下面这张表来自 <code className="text-foreground">/api/&lt;service&gt;/ping</code> 的实时响应，
          每 {REFETCH_SECONDS} 秒刷新一次。host 与 port 是各服务自报的容器信息——
          浏览器只请求了同源路径，能拿到七个不同的主机名，说明
          nginx → 网关 → 路由分发这一段是真的通的。
        </p>
      </div>

      <ServiceStatusGrid />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>UI 原子自检</CardTitle>
          <CardDescription>
            确认 button / card / tailwind 设计令牌三者都生效。
          </CardDescription>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button>主要按钮</Button>
            <Button variant="outline">描边</Button>
            <Button variant="ghost" size="sm">
              幽灵
            </Button>
          </div>
        </Card>

        {import.meta.env.DEV ? (
          <Card className="space-y-3">
            <CardTitle>开发期自检</CardTitle>
            <CardDescription>
              这张卡片只在 dev 构建里存在，生产产物中会被摇掉。
            </CardDescription>
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.assign('/__error-demo')
                }}
              >
                触发 ErrorBoundary
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
