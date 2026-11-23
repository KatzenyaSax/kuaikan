import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { Empty } from '@/shared/ui/empty'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Empty
        title="404 · 这片星域空无一物"
        description="你访问的页面可能已被移动、删除，或地址拼写有误。"
        icon={<Compass className="h-5 w-5" />}
        action={
          <Link
            to="/"
            className="btn-aurora inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold"
          >
            回到发现画廊
          </Link>
        }
      />
    </div>
  )
}
