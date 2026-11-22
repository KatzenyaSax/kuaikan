import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useCommunityList } from '@/features/community/api'
import { CreateCommunityDialog } from '@/features/community/create-community-dialog'
import { useLatestPosts } from '@/features/content/api'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button, buttonClass } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Group, GroupFooter, groupRowClass } from '@/shared/ui/group'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/lib/cn'

/** 与 S1 的顶栏同一个栏宽与内缩：顶栏左边界 = 页面内容左边界 */
const CONTAINER = 'mx-auto w-full max-w-[980px] px-6'

/** hero 渐显的错开。80ms 一档，再多就会让人等 */
const heroDelay = (ms: number): CSSProperties => ({ '--hero-delay': `${ms}ms` }) as CSSProperties

/** 「先逛逛」滚到下方列表。尊重 prefers-reduced-motion：位移会让人不适 */
function scrollToCommunities() {
  const el = document.getElementById('home-communities')
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

/**
 * 首页 = 最近更新。
 *
 * **它不是推荐页**。我们还没有推荐算法，所以这里按时间排序，
 * 并且在页面上明说这一点——「不假装有算法」比一个漂亮的空占位诚实得多。
 *
 * 三段结构（未登录；登录后只有第三段）：
 *   1. 浅底营销 hero：display 大标题 + 副标题 + 两个胶囊按钮，居中
 *   2. 全宽深色带：一句产品主张 + **只来自接口的真实数字**（社群数）
 *   3. 产品页主体：页面大标题 + 全部社群 + 最新帖子（inset grouped）
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
  // 深色带上只放**已经拿到的**数字：请求没回来就整块不渲染，不占位、不编造
  const communityCount = communities.data ? items.length : null

  return (
    <div data-testid="home-page">
      {authed ? null : (
        <>
          {/* ---------- 营销 hero（仅未登录） ---------- */}
          <section className="bg-background pb-16 pt-20 md:pb-24 md:pt-28">
            <div className={cn(CONTAINER, 'flex flex-col items-center text-center')}>
              <h1
                className="hero-in m-0 max-w-[14em] text-balance text-display"
                style={heroDelay(0)}
                data-testid="home-hero-title"
              >
                今天社区里在聊什么
              </h1>
              <p
                className="hero-in m-0 mt-6 max-w-[32em] text-balance text-sub leading-[1.55] text-muted-foreground"
                style={heroDelay(80)}
              >
                以社群为单位组织内容的讨论社区。按时间排序，不是个性化推荐。
              </p>
              <div
                className="hero-in mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
                style={heroDelay(160)}
              >
                <Link
                  to="/register"
                  className={buttonClass({ size: 'lg' })}
                  data-testid="home-hero-register"
                >
                  免费注册
                </Link>
                <Button variant="link" onClick={scrollToCommunities} data-testid="home-hero-browse">
                  先逛逛 ›
                </Button>
              </div>
            </div>
          </section>

          {/* ---------- 深色带（仅未登录） ---------- */}
          <section className="bg-ink py-16 text-on-ink md:py-20">
            <div className={cn(CONTAINER, 'hero-in')} style={heroDelay(240)}>
              <p className="m-0 max-w-[26em] text-balance text-sub leading-[1.4]">
                没有推荐算法。你看到的每一条，都是有人真的想说的话。
              </p>
              <p className="m-0 mt-4 max-w-[34em] text-aux leading-[1.75] text-on-ink-faint">
                排序只有一种：时间倒序。关注与社群是你的过滤器，不是我们的排序器。
              </p>
              {/* 没有数字就什么都不显示 —— 编一个数字是最容易、也最不诚实的选择 */}
              {communityCount !== null && communityCount > 0 ? (
                <div className="mt-12 flex items-baseline gap-2.5">
                  <span className="text-title font-semibold tabular-nums" data-testid="home-hero-stat">
                    {communityCount}
                  </span>
                  <span className="text-aux text-on-ink-faint">个社群已经在运行</span>
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}

      {/* ---------- 产品页主体 ---------- */}
      <section className="bg-surface pb-20 pt-12 md:pt-14">
        <div className={CONTAINER}>
          {authed ? (
            <header className="mb-10">
              <h1 className="m-0 text-title">今天社区里在聊什么</h1>
              <p className="m-0 mt-2 text-read text-muted-foreground">
                按最近更新排序，不是个性化推荐。
              </p>
            </header>
          ) : null}

          <section className="mb-12" id="home-communities">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="m-0 text-sub font-semibold">全部社群</h2>
              {authed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreating(true)}
                  data-testid="btn-new-community"
                >
                  建社群
                </Button>
              ) : (
                <Link to="/login?returnTo=/" className="text-aux text-primary hover:underline">
                  登录后可以建社群
                </Link>
              )}
            </div>

            {communities.isPending ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[68px] rounded-[var(--radius-lg)] bg-card" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <Group>
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
                      <Link
                        to="/login?returnTo=/"
                        className="text-aux text-primary hover:underline"
                      >
                        登录后创建
                      </Link>
                    )
                  }
                />
              </Group>
            ) : (
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3"
                data-testid="community-list"
              >
                {items.map((c) => (
                  <Link
                    key={c.id}
                    to={`/c/${encodeURIComponent(c.name ?? '')}`}
                    className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-card px-4 py-3.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-fill"
                    data-testid="community-card"
                  >
                    <Avatar url={null} name={c.name ?? ''} size={36} />
                    <span className="block min-w-0">
                      <span
                        className="block truncate text-body font-medium"
                        data-testid="community-card-name"
                      >
                        {c.name}
                      </span>
                      <span className="mt-0.5 block text-caption text-faint">
                        {c.memberCount} 成员
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="m-0 text-sub font-semibold">最新帖子</h2>
              <span className="text-caption text-faint">全站 · 按时间倒序</span>
            </div>

            {latest.isPending ? (
              <Group>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="px-4 py-4">
                    <Skeleton className="h-[15px] w-[62%]" />
                  </div>
                ))}
              </Group>
            ) : (latest.data ?? []).length === 0 ? (
              <Group>
                <Empty title="还没有帖子" description="进一个社群，发第一篇。" />
              </Group>
            ) : (
              <Group>
                <ul className="m-0 list-none p-0" data-testid="latest-posts">
                  {(latest.data ?? []).map((p) => (
                    <li key={p.id} className={groupRowClass({ interactive: true })}>
                      <Link
                        to={`/c/${encodeURIComponent(nameById.get(p.communityId ?? '') ?? '')}/p/${p.id ?? ''}`}
                        className="group block min-w-0"
                      >
                        <p className="m-0 text-body font-medium leading-[1.5] group-hover:text-primary">
                          {p.title}
                        </p>
                        <span className="mt-1.5 flex items-center gap-2.5 text-caption text-faint">
                          {nameById.get(p.communityId ?? '') ? (
                            <Pill>{nameById.get(p.communityId ?? '')}</Pill>
                          ) : null}
                          <span className="tabular-nums">{p.createdAt?.slice(0, 10)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* 诚实说明放在列表下面：它是"读完之后"的补充，不该占着页面顶部 */}
                <GroupFooter>
                  这个版本按时间排序，个性化推荐在后续版本开放 —— 现在不假装有算法。
                </GroupFooter>
              </Group>
            )}
          </section>
        </div>
      </section>

      {creating ? <CreateCommunityDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
