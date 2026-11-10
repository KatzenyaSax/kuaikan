import { Link } from 'react-router'
import { Button } from '@/shared/ui/button'

/**
 * 首页目前只是入口页。
 *
 * 服务状态、UI 原子自检、MQ/Sentinel 探针全部搬到了 /test ——
 * 那些是诊断内容，不该出现在产品首页上。
 */
export function HomePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-[0.14em]">kuaikan</h1>
        <p className="mt-2 text-xs text-muted-foreground">一个以社群为单位的讨论社区</p>
      </div>

      <Button variant="outline" data-testid="btn-register">
        <Link to="/register">注册账号</Link>
      </Button>
    </div>
  )
}
