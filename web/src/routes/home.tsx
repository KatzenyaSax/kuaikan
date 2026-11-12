import { useState } from 'react'
import { useCommunityList, useMyCommunities } from '@/features/community/api'
import { CommunityCard } from '@/features/community/community-card'
import { CreateCommunityDialog } from '@/features/community/create-community-dialog'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 首页 = 社群列表。游客可读。
 *
 * 建社群要登录：游客看到的是"登录后可以建社群"，点了跳登录页并带上
 * redirect，登录后回到首页——不做"先弹窗再报未登录"。
 */
export function HomePage() {
  const status = useSession((s) => s.status)
  const list = useCommunityList(null)
  const [creating, setCreating] = useState(false)

  const canCreate = status === 'authenticated'
  const items = list.data?.items ?? []
  // 我加入的社群：P2.4 的双栏里这块会挪进左栏顶部，这里先作为一个独立区块
  const mine = useMyCommunities(canCreate)
  const mineItems = mine.data?.items ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">社群</h1>
          <p className="mt-1 text-[11px] text-muted-foreground">以社群为单位组织讨论</p>
        </div>
        {canCreate ? (
          <Button size="sm" onClick={() => setCreating(true)} data-testid="btn-new-community">
            建社群
          </Button>
        ) : (
          <a
            href="/login?redirect=/"
            className="text-[11px] text-muted-foreground underline"
            data-testid="link-login-to-create"
          >
            登录后可以建社群
          </a>
        )}
      </div>

      {canCreate && mineItems.length > 0 ? (
        <div className="space-y-2" data-testid="my-communities">
          <h2 className="text-[11px] font-medium text-muted-foreground">我加入的社群</h2>
          <div className="flex flex-wrap gap-2">
            {mineItems.map((c) => (
              <a
                key={c.id}
                href={`/c/${encodeURIComponent(c.name ?? '')}`}
                className="rounded-full border border-border px-3 py-1 text-[11px] hover:bg-muted/40"
                data-testid="my-community-chip"
              >
                {c.name}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : list.isError ? (
        <Card>
          <p className="text-sm text-danger" data-testid="community-list-error">
            {authErrorMessage(list.error)}
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="space-y-1 text-center">
          <CardTitle>还没有社群</CardTitle>
          <CardDescription>
            {canCreate ? '点右上角「建社群」开第一个' : '登录后可以创建第一个社群'}
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="community-list">
          {items.map((c) => (
            <CommunityCard key={c.id} community={c} />
          ))}
        </div>
      )}

      {creating ? <CreateCommunityDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
