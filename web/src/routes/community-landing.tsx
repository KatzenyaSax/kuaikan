import { Navigate } from 'react-router'
import { useMyCommunities } from '@/features/community/api'
import { useSession } from '@/features/auth/session'
import { Empty } from '@/shared/ui/empty'
import { Button } from '@/shared/ui/button'
import { Link } from 'react-router'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * `/c` —— 社群入口但没指定是哪个社群。
 *
 * 三种情况：
 *   1. 已加入社群 → 直接进第一个（省一次点击，符合"社群"这个导航项的意图）
 *   2. 登录但一个都没加 → 空态引导去首页
 *   3. 游客 → 空态 + 登录引导
 */
export function CommunityLanding() {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)

  if (!authed) {
    return (
      <div className="mx-auto max-w-[40rem] px-6 pt-12">
        <Empty
          title="登录后可以加入社群"
          description="加入之后，这里会直接进入你的社群。"
          action={
            <Link to="/login?returnTo=/c">
              <Button size="sm">登录</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (mine.isPending) {
    return (
      <div className="mx-auto max-w-[40rem] px-6 pt-12">
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const first = (mine.data?.items ?? [])[0]
  if (first?.name) {
    return <Navigate to={`/c/${encodeURIComponent(first.name)}`} replace />
  }

  return (
    <div className="mx-auto max-w-[40rem] px-6 pt-12">
      <Empty
        title="还没有加入任何社群"
        description="去首页看看有哪些社群。"
        action={
          <Link to="/">
            <Button size="sm">去首页</Button>
          </Link>
        }
      />
    </div>
  )
}
