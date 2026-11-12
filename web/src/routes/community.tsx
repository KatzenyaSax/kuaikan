import { Link, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 社群页。
 *
 * **P2.1 阶段是单栏骨架**：社群概览 + 帖子列表占位。
 * P2.4 会把它改成双栏（左列表 + 右正文），届时这里的概览会挪进右栏的空态，
 * 帖子列表挪进左栏——所以概览部分现在就要写成独立组件，避免 P2.4 重写。
 *
 * 路由参数是**社群名**（不是 id）：名称本身就是标识。
 */
export function CommunityPage() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const status = useSession((s) => s.status)

  if (detail.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <p className="text-sm text-danger" data-testid="community-error">
            {authErrorMessage(detail.error)}
          </p>
          <Link to="/" className="mt-3 inline-block text-[11px] text-muted-foreground underline">
            返回社群列表
          </Link>
        </Card>
      </div>
    )
  }

  const community = detail.data

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="community-page">
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle data-testid="community-name">{community.name}</CardTitle>
          <span className="text-[11px] text-muted-foreground">
            {community.memberCount} 成员
          </span>
        </div>
        {community.description ? (
          <CardDescription className="whitespace-pre-wrap" data-testid="community-desc">
            {community.description}
          </CardDescription>
        ) : (
          <CardDescription>这个社群还没有简介</CardDescription>
        )}
        <p className="text-[11px] text-muted-foreground">
          {/* 加入功能在 P2.2；此刻只说明为什么还没有按钮，而不是放一个假的 */}
          {status === 'authenticated' ? '加入功能开发中' : '登录后可以加入社群'}
        </p>
      </Card>

      <Card className="space-y-3">
        <CardTitle>帖子</CardTitle>
        <CardDescription>发帖与帖子列表在 P2.3 / P2.4 实现</CardDescription>
      </Card>
    </div>
  )
}
