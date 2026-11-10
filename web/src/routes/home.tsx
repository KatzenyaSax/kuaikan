import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-wide">kuaikan</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          P0.5 · S2 外壳与路由已就绪。服务状态面板将在 S5 接入真实数据。
        </p>
      </div>

      <Card className="space-y-3">
        <CardTitle>UI 原子自检</CardTitle>
        <CardDescription>
          以下三个按钮用来确认 button / card / tailwind token 三者都生效。
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
          <CardTitle>开发期自检入口</CardTitle>
          <CardDescription>
            这个卡片只在 dev 构建里存在，生产产物中会被摇掉。
          </CardDescription>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button variant="outline" size="sm" onClick={() => window.location.assign('/__error-demo')}>
              触发 ErrorBoundary
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
