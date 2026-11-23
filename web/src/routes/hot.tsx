import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  Crown,
  Flame,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { useHotRank } from '@/features/rank/api'
import type { HotRange } from '@/features/rank/api'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/lib/cn'

export function HotPage() {
  const [range, setRange] = useState<HotRange>('day')
  const { data, isPending, isError } = useHotRank(range)

  const items = data?.items ?? []
  const maxScore = Math.max(...items.map((i) => Number(i.score ?? 0)), 1)
  const top3 = items.slice(0, 3)
  const rest = items.slice(3)

  return (
    <div data-testid="hot-page" className="mx-auto max-w-5xl space-y-7">
      {/* 顶部极光标题 + 日/周切换 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <LuminousIcon
            size="lg"
            gradient="linear-gradient(135deg, #F59E0B 0%, #FB7185 60%, #EC4899 100%)"
          >
            <Flame className="h-6 w-6" />
          </LuminousIcon>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            极光<span className="text-aurora">热榜</span>
          </h1>
        </div>

        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: 'day', label: '今日热榜' },
            { value: 'week', label: '本周热榜' },
          ]}
        />
      </div>

      {/* 榜单主体 */}
      {isPending ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-3xl" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <Empty title="热榜暂时无法加载" description="排行服务正在恢复中，请稍后再试。" />
      ) : items.length === 0 ? (
        <Empty
          title="热榜暂时空缺"
          description="要有真实互动（评论、点赞、收藏或分享）才会产生热度，去社群参与讨论点亮榜单吧。"
          icon={<Flame className="h-5 w-5" />}
        />
      ) : (
        <div data-testid="hot-list" className="space-y-6">
          {/* TOP 3 极光领奖台 */}
          <div className="grid gap-4 md:grid-cols-3 md:items-end">
            {top3.map((item, idx) => {
              const rank = item.rank ?? idx + 1
              const score = Number(item.score ?? 0)
              const pct = Math.max(12, Math.min(100, (score / maxScore) * 100))
              const commName = item.communityName ?? null
              const chroma = getCommunityChroma(commName)
              const href =
                commName && item.postId
                  ? `/c/${encodeURIComponent(commName)}/p/${encodeURIComponent(item.postId)}`
                  : null

              const podiumStyle =
                idx === 0
                  ? {
                      grad: 'linear-gradient(135deg, #FBBF24 0%, #F97316 55%, #FB7185 100%)',
                      badge: 'TOP 1 · 榜首',
                      order: 'md:order-2 md:-translate-y-2',
                      minH: 'md:min-h-[212px]',
                    }
                  : idx === 1
                    ? {
                        grad: 'linear-gradient(135deg, #38BDF8 0%, #818CF8 100%)',
                        badge: 'TOP 2',
                        order: 'md:order-1',
                        minH: 'md:min-h-[188px]',
                      }
                    : {
                        grad: 'linear-gradient(135deg, #FB7185 0%, #D946EF 100%)',
                        badge: 'TOP 3',
                        order: 'md:order-3',
                        minH: 'md:min-h-[182px]',
                      }

              const card = (
                <Card
                  padding="none"
                  className={cn(
                    'group flex h-full flex-col justify-between overflow-hidden rounded-3xl transition-transform duration-300',
                    href ? 'hover:-translate-y-1.5' : 'opacity-70',
                    podiumStyle.minH,
                  )}
                >
                  <div className="h-1.5 w-full" style={{ background: podiumStyle.grad }} />
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-xs font-extrabold text-white shadow-md"
                          style={{ background: podiumStyle.grad }}
                        >
                          {idx === 0 ? <Crown className="h-3.5 w-3.5" /> : <Sparkles className="h-3 w-3" />}
                          {podiumStyle.badge}
                        </span>
                        <span className="tabular-nums font-mono text-sm font-bold text-foreground">
                          {score.toFixed(1)}
                        </span>
                      </div>

                      <h2 className="line-clamp-2 font-display text-base font-bold leading-snug text-foreground transition-colors group-hover:text-primary">
                        {item.title}
                      </h2>
                    </div>

                    <div className="mt-4 space-y-2.5">
                      {/* 动画热度能量条 */}
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${String(pct)}%` }}
                          transition={{ duration: 0.7, delay: idx * 0.1, ease: [0.22, 1, 0.36, 1] }}
                          className="h-full rounded-full"
                          style={{ background: podiumStyle.grad }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {commName ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                            style={{ background: chroma.gradient }}
                          >
                            #{commName}
                          </span>
                        ) : (
                          <span>社群已下线</span>
                        )}
                        <span className="tabular-nums font-mono text-[11px]">#{String(rank)}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              )

              return (
                <motion.div
                  key={item.postId}
                  data-testid="hot-item"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: idx * 0.08 }}
                  className={podiumStyle.order}
                >
                  {href ? (
                    <Link to={href} className="block h-full">
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </motion.div>
              )
            })}
          </div>

          {/* 第 4 ~ 50 名流光列表 */}
          {rest.length > 0 && (
            <div className="space-y-2.5">
              {rest.map((item, idx) => {
                const rank = item.rank ?? idx + 4
                const score = Number(item.score ?? 0)
                const pct = Math.max(6, Math.min(100, (score / maxScore) * 100))
                const commName = item.communityName ?? null
                const chroma = getCommunityChroma(commName)
                const href =
                  commName && item.postId
                    ? `/c/${encodeURIComponent(commName)}/p/${encodeURIComponent(item.postId)}`
                    : null

                const inner = (
                  <Card
                    padding="sm"
                    className={cn(
                      'group transition-all duration-200',
                      href ? 'hover:-translate-y-0.5' : 'opacity-65',
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <span className="tabular-nums flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] font-display text-sm font-bold text-secondary-foreground">
                        {String(rank)}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="truncate font-display text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">
                            {item.title}
                          </h3>
                          <span className="tabular-nums inline-flex shrink-0 items-center gap-1 font-mono text-xs font-bold text-primary">
                            <TrendingUp className="h-3.5 w-3.5" />
                            热度 {score.toFixed(1)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {commName ? (
                            <Pill
                              className="border-none px-2 py-0 text-[11px] font-semibold text-white"
                              style={{ background: chroma.gradient }}
                            >
                              #{commName}
                            </Pill>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">社群已下线</span>
                          )}
                          <div className="hidden h-1 max-w-[160px] flex-1 overflow-hidden rounded-full bg-[var(--bg-input)] sm:block">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${String(pct)}%` }}
                              transition={{ duration: 0.5, delay: Math.min(idx * 0.025, 0.35) }}
                              className="h-full rounded-full"
                              style={{ background: chroma.gradient }}
                            />
                          </div>
                        </div>
                      </div>

                      {href && (
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                      )}
                    </div>
                  </Card>
                )

                return (
                  <div key={item.postId} data-testid="hot-item">
                    {href ? (
                      <Link to={href} className="block">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
