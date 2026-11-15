import { useState } from 'react'
import { Link } from 'react-router'
import { useCommunityList } from '@/features/community/api'
import { CreateCommunityDialog } from '@/features/community/create-community-dialog'
import { useLatestPosts } from '@/features/content/api'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 首页 = 最近更新。
 *
 * **它不是推荐页**。我们还没有推荐算法，所以这里按时间排序，
 * 并且在页面上明说这一点——「不假装有算法」比一个漂亮的空占位诚实得多。
 *
 * 两个区块都用真实数据：
 *   1. 全部社群（按创建时间倒序，现有的社群列表接口）
 *   2. 全站最新帖（跨社群，/posts/latest）
 *
 * 社群名从第 1 个请求的结果里映射，所以帖子列表不需要后端再做聚合
 * （那是 ADR 0005 说的"读路径由前端并行聚合"）。
 */
export function HomePage() {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const [creating, setCreating] = useState(false)
  const communities = useCommunityList(null)
  const latest = useLatestPosts(10)

  const items = communities.data?.items ?? []
  const nameById = new Map(items.map((c) => [c.id ?? '', c.name ?? '']))

  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-12" data-testid="home-page">
      <div className="mb-13 max-w-[40rem]">
        <h1 className="m-0 mb-3.5 text-display font-[640] tracking-[-0.01em]">
          今天社区里在聊什么
        </h1>
        <p className="m-0 text-read text-muted-foreground">
          按最近更新排序，不是个性化推荐。你关注的社群与作者会被优先展示。
        </p>
        <div className="mt-4.5 flex items-start gap-2 rounded-[var(--radius-md)] bg-surface px-3.5 py-2.5 text-aux text-muted-foreground">
          <span className="shrink-0 rounded-full border border-border bg-background px-2 text-caption text-faint">
            当前排序
          </span>
          <span>这个版本按时间排序。个性化推荐在后续版本开放 —— 现在不假装有算法。</span>
        </div>
      </div>

      <section className="mb-14">
        <div className="mb-4.5 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-sub font-semibold">全部社群</h2>
          {authed ? (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)} data-testid="btn-new-community">
              建社群
            </Button>
          ) : (
            <Link to="/login?returnTo=/" className="text-aux text-primary hover:underline">
              登录后可以建社群
            </Link>
          )}
        </div>

        {communities.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
          </div>
        ) : items.length === 0 ? (
          <Empty
            title="还没有社群"
            description="第一个社群由你来开。"
            testId="community-list"
            action={
              authed ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  建社群
                </Button>
              ) : (
                <Link to="/login?returnTo=/" className="text-aux text-primary hover:underline">
                  登录后创建
                </Link>
              )
            }
          />
        ) : (
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5"
            data-testid="community-list"
          >
            {items.map((c) => (
              <Link
                key={c.id}
                to={`/c/${encodeURIComponent(c.name ?? '')}`}
                className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border p-3.5 text-left transition-colors duration-[150ms] hover:bg-surface"
                data-testid="community-card"
              >
                <Avatar url={null} name={c.name ?? ''} size={40} />
                <span className="block min-w-0">
                  <span className="block truncate text-body font-medium" data-testid="community-card-name">
                    {c.name}
                  </span>
                  <span className="block text-caption text-faint">
                    {c.memberCount} 成员
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4.5 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-sub font-semibold">最新帖子</h2>
        </div>

        {latest.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (latest.data ?? []).length === 0 ? (
          <Empty title="还没有帖子" description="进一个社群，发第一篇。" />
        ) : (
          <ul className="m-0 list-none p-0" data-testid="latest-posts">
            {(latest.data ?? []).map((p) => (
              <li key={p.id} className="py-4 [&+&]:border-t [&+&]:border-border">
                <Link
                  to={`/c/${encodeURIComponent(nameById.get(p.communityId ?? '') ?? '')}/p/${p.id ?? ''}`}
                  className="group block"
                >
                  <p className="m-0 text-body font-medium leading-[1.5] group-hover:text-primary">
                    {p.title}
                  </p>
                  <span className="mt-1.5 flex items-center gap-2.5 text-caption text-faint">
                    {nameById.get(p.communityId ?? '') ? (
                      <Pill>{nameById.get(p.communityId ?? '')}</Pill>
                    ) : null}
                    <span>{p.createdAt?.slice(0, 10)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating ? <CreateCommunityDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
