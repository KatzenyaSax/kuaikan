import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useMyCommunities } from '@/features/community/api'
import { useSession } from '@/features/auth/session'
import { Empty } from '@/shared/ui/empty'
import { Button } from '@/shared/ui/button'
import { Link } from 'react-router'
import { Skeleton } from '@/shared/ui/skeleton'

/** 与 S1 的顶栏同一个栏宽与内缩 */
const CONTAINER = 'mx-auto w-full max-w-[980px] px-6 pb-24 pt-12'

/**
 * `/c` —— 社群入口但没指定是哪个社群。
 *
 * 三种情况：
 *   1. 已加入社群 → 直接进第一个（省一次点击，符合"社群"这个导航项的意图）
 *   2. 登录但一个都没加 → 空态引导去首页
 *   3. 游客 → 空态 + 登录引导
 *
 * 三种情况共用一个产品页外壳（大标题 + 一行副标题），
 * 这样"跳转前的最后一帧"和"跳转后的页面"是同一套排版，不会闪一下别的样子。
 */
export function CommunityLanding() {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)

  if (!authed) {
    return (
      <Shell>
        <Empty
          title="登录后可以加入社群"
          description="加入之后，这里会直接进入你的社群。"
          action={
            <Link to="/login?returnTo=/c">
              <Button size="md">登录</Button>
            </Link>
          }
        />
      </Shell>
    )
  }

  if (mine.isPending) {
    return (
      <Shell>
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
      </Shell>
    )
  }

  const first = (mine.data?.items ?? [])[0]
  if (first?.name) {
    return <Navigate to={`/c/${encodeURIComponent(first.name)}`} replace />
  }

  return (
    <Shell>
      <Empty
        title="还没有加入任何社群"
        description="去首页看看有哪些社群。"
        action={
          <Link to="/">
            <Button size="md">去首页</Button>
          </Link>
        }
      />
    </Shell>
  )
}

/** 产品页外壳：大标题 + 一行副标题，左对齐 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={CONTAINER}>
      <header className="mb-10">
        <h1 className="m-0 text-title">社群</h1>
        <p className="m-0 mt-2 max-w-[38rem] text-read text-muted-foreground">
          加入一个社群，这里会直接进入你的社群。
        </p>
      </header>
      {children}
    </div>
  )
}
