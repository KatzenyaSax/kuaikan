import { useState } from 'react'
import { REFETCH_SECONDS } from '@/features/status/api'
import { ServiceStatusGrid } from '@/features/status/service-status-grid'
import { MqPanel } from '@/features/devtools/mq-panel'
import { SentinelPanel } from '@/features/devtools/sentinel-panel'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription } from '@/shared/ui/card'

/**
 * 诊断页。**不属于产品功能**，只用来确认各条链路是否通。
 *
 * P0 时代这些内容是一个独立静态页（/test/，纯 HTML）；
 * 现在合并进 React 应用，好处是类型来自 OpenAPI、跟随后端契约变化，
 * 坏处是它和产品代码同生共死（部署挂了它也挂）。判断是值得的：
 * 一个能编译期校验的类型化诊断台，比一个手工维护的静态页可靠得多。
 */
export function TestPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">诊断台</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          这些内容不属于产品功能。服务状态每 {REFETCH_SECONDS} 秒刷新一次；
          host / port 是各服务自报的容器信息——浏览器只请求了同源路径，
          能拿到七个不同主机名，说明 nginx → 网关 → 路由分发这一段是真的通的。
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">服务状态</h2>
        <ServiceStatusGrid />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <MqPanel />
        <SentinelPanel />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">UI 原子自检</h2>
        <UiAtomsCard />
      </section>

      <ErrorBoundaryDemo />
    </div>
  )
}

/** 确认 button / card / 设计令牌三者都生效 */
function UiAtomsCard() {
  return (
    <Card className="space-y-3">
      <CardDescription>
        三个按钮依次是 primary / outline / ghost。如果样式没差别，说明 Tailwind 令牌没生效。
      </CardDescription>
      <div className="flex flex-wrap gap-3">
        <Button>主要按钮</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost" size="sm">
          幽灵
        </Button>
      </div>
    </Card>
  )
}

/** ErrorBoundary 只在 dev 下可触发，生产构建里整块被摇掉 */
function ErrorBoundaryDemo() {
  const [gone] = useState(() => import.meta.env.DEV)
  if (!gone) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">错误边界自检</h2>
      <Card className="space-y-3">
        <CardDescription>
          这个区块只在 dev 构建里存在。点击后应看到「页面出错了」，而不是白屏。
        </CardDescription>
        <div>
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
    </section>
  )
}
