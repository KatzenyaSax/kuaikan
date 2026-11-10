import { Link } from 'react-router'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

export function NotFoundPage() {
  return (
    <Card className="space-y-3">
      <CardTitle>404 · 页面不存在</CardTitle>
      <CardDescription>
        你访问的路径在前端路由里没有匹配项。这不是白屏，是路由兜底生效了。
      </CardDescription>
      <div className="pt-1">
        <Link to="/">
          <Button variant="outline" size="sm">
            回到首页
          </Button>
        </Link>
      </div>
    </Card>
  )
}
