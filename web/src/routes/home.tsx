import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Clock,
  Crown,
  Flame,
  Layers,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useCommunityList } from '@/features/community/api'
import { CreateCommunityDialog } from '@/features/community/create-community-dialog'
import { useLatestPosts } from '@/features/content/api'
import { PostFeed } from '@/features/content/post-feed'
import { useHotRank } from '@/features/rank/api'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'

export function HomePage() {
  const status = useSession((s) => s.status)
  const [cursor, setCursor] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const communities = useCommunityList(cursor)
  const latest = useLatestPosts(12)
  const hotDay = useHotRank('day')

  const commItems = communities.data?.items ?? []
  const hotTop3 = (hotDay.data?.items ?? []).slice(0, 3)
  const totalMembers = commItems.reduce((sum, c) => sum + (c.memberCount ?? 0), 0)

  return (
    <div data-testid="home-page" className="space-y-8">
      {/* ====================================================================
          BENTO 非对称首屏：左侧极光主视觉 Hero + 右侧今日热榜 Top 3 预览台
         ==================================================================== */}
      <section className="grid gap-5 lg:grid-cols-12">
        {/* 左侧 Hero Bento (7列) */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-7"
        >
          <Card
            padding="lg"
            className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl"
          >
            {/* 内部极光漫射斑 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full opacity-35 blur-3xl"
              style={{ background: 'var(--accent-gradient)' }}
            />

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="aurora">
                  <Sparkles className="h-3 w-3" />
                  Aurora Community Gallery
                </Pill>
                <span
                  data-testid="home-hero-stat"
                  className="tabular-nums inline-flex items-center gap-1.5 rounded-full border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-3 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  <Layers className="h-3 w-3 text-primary" />
                  {String(commItems.length)} 个活跃社群 · {String(totalMembers)} 人次加入
                </span>
              </div>

              <h1
                data-testid="home-hero-title"
                className="font-display text-3xl leading-[1.15] font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-[2.6rem]"
              >
                在流光溢彩的
                <span className="text-aurora">社群宇宙</span>
                里，展开高密度深度讨论
              </h1>

              <p className="max-w-xl text-sm leading-relaxed text-secondary-foreground sm:text-base">
                加入感兴趣的社群，和同好一起聊聊真想法。
              </p>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/hot"
                data-testid="home-hero-browse"
                className="btn-aurora inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold"
              >
                <Flame className="h-4 w-4" />
                <span>探索极光热榜</span>
                <ArrowRight className="h-4 w-4" />
              </Link>

              {status === 'authenticated' ? (
                <Button
                  variant="secondary"
                  size="lg"
                  data-testid="btn-new-community"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-4 w-4 text-primary" />
                  创建新社群
                </Button>
              ) : (
                <Link
                  to="/register"
                  data-testid="home-hero-register"
                  className="glass-panel inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.5)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>注册加入讨论</span>
                </Link>
              )}
            </div>
          </Card>
        </motion.div>

        {/* 右侧今日热榜速览 Bento (5列) */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-5"
        >
          <Card padding="md" className="flex h-full flex-col justify-between rounded-3xl">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <LuminousIcon
                    size="sm"
                    gradient="linear-gradient(135deg, #F59E0B, #FB7185)"
                  >
                    <Flame className="h-4 w-4" />
                  </LuminousIcon>
                  <h2 className="font-display text-sm font-bold text-foreground">
                    今日热榜 Top 3
                  </h2>
                </div>
                <Link
                  to="/hot"
                  className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-[var(--color-primary-soft)]"
                >
                  全部 Top 50 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {hotDay.isPending ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-2xl" />
                  ))}
                </div>
              ) : hotTop3.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-8 text-center text-xs text-muted-foreground">
                  暂无上榜帖子，点赞或评论即可点亮今日热榜
                </div>
              ) : (
                <div className="space-y-2.5">
                  {hotTop3.map((item, idx) => {
                    const medalGrad =
                      idx === 0
                        ? 'linear-gradient(135deg, #FBBF24, #F97316)'
                        : idx === 1
                          ? 'linear-gradient(135deg, #38BDF8, #818CF8)'
                          : 'linear-gradient(135deg, #FB7185, #EC4899)'
                    const href =
                      item.communityName && item.postId
                        ? `/c/${encodeURIComponent(item.communityName)}/p/${encodeURIComponent(item.postId)}`
                        : null

                    const row = (
                      <div className="group flex items-center gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-3 transition-all hover:border-[rgba(var(--accent-rgb),0.4)] hover:bg-[var(--bg-surface-hover)]">
                        <span
                          className="tabular-nums flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-display text-sm font-extrabold text-white shadow-md"
                          style={{ background: medalGrad }}
                        >
                          {idx === 0 ? <Crown className="h-4 w-4" /> : String(item.rank ?? idx + 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                            {item.title}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            {item.communityName && (
                              <span className="truncate font-medium text-primary/90">
                                #{item.communityName}
                              </span>
                            )}
                            <span className="tabular-nums ml-auto font-mono font-semibold text-warning">
                              {Number(item.score ?? 0).toFixed(1)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )

                    return href ? (
                      <Link key={item.postId} to={href} className="block">
                        {row}
                      </Link>
                    ) : (
                      <div key={item.postId}>{row}</div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      </section>

      {/* ====================================================================
          多色极光社群画廊（每个社群自带专属色带与环境辉光）
         ==================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LuminousIcon size="sm">
              <Layers className="h-4 w-4" />
            </LuminousIcon>
            <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
              探索社群
            </h2>
          </div>

          {status === 'authenticated' && (
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 text-primary" />
              新建社群
            </Button>
          )}
        </div>

        {communities.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-3xl" />
            ))}
          </div>
        ) : commItems.length === 0 ? (
          <Empty title="还没有社群" description="成为第一个创建主题社群的开拓者吧。" />
        ) : (
          <div
            data-testid="community-list"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {commItems.map((c, idx) => {
              const name = c.name ?? ''
              const chroma = getCommunityChroma(name)
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.3) }}
                >
                  <Link
                    to={`/c/${encodeURIComponent(name)}`}
                    data-testid="community-card"
                    className="block h-full"
                  >
                    <Card
                      padding="none"
                      className="group flex h-full flex-col overflow-hidden rounded-3xl transition-transform duration-300 hover:-translate-y-1"
                    >
                      {/* 顶部社群专属极光流光带 */}
                      <div
                        className="h-1.5 w-full opacity-90 transition-all duration-300 group-hover:h-2"
                        style={{ background: chroma.gradient }}
                      />

                      <div className="flex flex-1 flex-col gap-3 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar
                              name={name}
                              src={c.avatarUrl}
                              size="md"
                              shape="rounded"
                            />
                            <h3
                              data-testid="community-card-name"
                              className="truncate font-display text-base font-bold text-foreground transition-colors group-hover:text-primary"
                            >
                              {name}
                            </h3>
                          </div>

                          <span className="tabular-nums inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
                            <Users className="h-3 w-3 text-primary" />
                            {String(c.memberCount ?? 0)}
                          </span>
                        </div>

                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {c.description || '自由开放的主题讨论社群。'}
                        </p>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        )}

        {(communities.data?.nextCursor || cursor) && (
          <div className="flex justify-center gap-3 pt-1">
            {cursor && (
              <Button variant="secondary" size="sm" onClick={() => setCursor(null)}>
                返回第一页
              </Button>
            )}
            {communities.data?.nextCursor && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCursor(communities.data?.nextCursor ?? null)}
              >
                查看更多社群
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ====================================================================
          全站最新动态流（纯时间倒序）
         ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LuminousIcon
              size="sm"
              gradient="linear-gradient(135deg, #06B6D4, #3B82F6)"
            >
              <Clock className="h-4 w-4" />
            </LuminousIcon>
            <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
              最新帖子
            </h2>
          </div>
        </div>

        <PostFeed
          posts={latest.data ?? []}
          isPending={latest.isPending}
          testId="latest-posts"
          emptyTitle="全站暂时还没有帖子"
          emptyDescription="进入任一社群，发布第一篇帖子点亮讨论广场吧。"
        />
      </section>

      <CreateCommunityDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
