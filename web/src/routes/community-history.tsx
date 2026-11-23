import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Crown,
  Edit3,
  History,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react'
import {
  useCommunityAdminHistory,
  useCommunityDetail,
  useCommunityHistory,
} from '@/features/community/api'
import type { HistoryCategory } from '@/features/community/api'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { absoluteDate, absoluteDateTime } from '@/shared/lib/time'

const EVENT_META: Record<
  string,
  { label: string; gradient: string; icon: typeof Sparkles }
> = {
  COMMUNITY_CREATED: {
    label: '社群创立',
    gradient: 'linear-gradient(135deg, #FBBF24, #F97316)',
    icon: Sparkles,
  },
  ADMIN_TRANSFERRED: {
    label: '管理员交接',
    gradient: 'linear-gradient(135deg, #A78BFA, #EC4899)',
    icon: Crown,
  },
  INFO_UPDATED: {
    label: '信息更新',
    gradient: 'linear-gradient(135deg, #22D3EE, #3B82F6)',
    icon: Edit3,
  },
  MEMBER_BANNED: {
    label: '成员封禁',
    gradient: 'linear-gradient(135deg, #FB7185, #E11D48)',
    icon: ShieldBan,
  },
  MEMBER_UNBANNED: {
    label: '解除封禁',
    gradient: 'linear-gradient(135deg, #34D399, #06B6D4)',
    icon: ShieldCheck,
  },
}

export function CommunityHistoryPage() {
  const { name } = useParams()
  const communityName = name ?? ''
  const [category, setCategory] = useState<HistoryCategory>('all')

  const detail = useCommunityDetail(communityName)
  const adminHistory = useCommunityAdminHistory(communityName)
  const history = useCommunityHistory(communityName, category)
  const chroma = getCommunityChroma(detail.data?.name ?? communityName)

  const terms = useMemo(() => adminHistory.data?.items ?? [], [adminHistory.data])
  const events = useMemo(
    () => history.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [history.data],
  )

  const allUserIds = useMemo(() => {
    const ids: Array<string | undefined> = []
    for (const t of terms) ids.push(t.userId)
    for (const e of events) {
      ids.push(e.operatorId)
      ids.push(e.targetUserId)
    }
    return ids
  }, [terms, events])

  const { data: users } = useUserSummaries(allUserIds)

  return (
    <div data-testid="community-history-page" className="mx-auto max-w-4xl space-y-7">
      {/* 顶部返回与标题 */}
      <div className="space-y-4">
        <Link
          to={`/c/${encodeURIComponent(communityName)}`}
          data-testid="history-back-link"
          className="glass-panel inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.45)] hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-primary" />
          返回「{detail.data?.name ?? communityName}」
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <LuminousIcon size="lg" gradient={chroma.gradient}>
              <History className="h-6 w-6" />
            </LuminousIcon>
            <h1
              data-testid="history-title"
              className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl"
            >
              {detail.data?.name ?? communityName} ·{' '}
              <span className="text-aurora">社群编年史</span>
            </h1>
          </div>
        </div>
      </div>

      {/* ====================================================================
          历代管理员勋章脉络
         ==================================================================== */}
      <section data-testid="admin-history-section" className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Crown className="h-4 w-4 text-warning" />
          <h2 className="font-display text-sm font-bold tracking-wide text-foreground">
            历代管理员脉络
          </h2>
        </div>

        {adminHistory.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : terms.length === 0 ? (
          <Card padding="sm" spotlight={false}>
            <p className="text-xs text-muted-foreground">暂无管理员交接记录。</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {terms.map((t, idx) => {
              const u = pickAuthor(users, t.userId)
              const nick = u?.nickname ?? (t.userId ? `用户 #${t.userId.slice(-4)}` : '已注销用户')
              return (
                <motion.div
                  key={`${String(t.term)}-${t.userId ?? String(idx)}`}
                  data-testid="admin-term-item"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: idx * 0.05 }}
                >
                  <Card
                    padding="sm"
                    className={
                      t.current
                        ? 'rounded-2xl border-warning/45 shadow-lg'
                        : 'rounded-2xl'
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular-nums rounded-lg border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-2 py-0.5 font-mono text-[11px] font-bold text-secondary-foreground">
                        第 {String(t.term ?? idx + 1)} 任
                      </span>
                      {t.current && (
                        <Pill tone="warning" data-testid="admin-term-current">
                          <Crown className="h-3 w-3" />
                          现任
                        </Pill>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2.5">
                      <Avatar name={nick} src={u?.avatarUrl} size="sm" ring={Boolean(t.current)} />
                      <div className="min-w-0">
                        {t.userId ? (
                          <Link
                            to={`/u/${encodeURIComponent(t.userId)}`}
                            data-testid="admin-term-user"
                            className="block truncate text-sm font-bold text-foreground hover:text-primary"
                          >
                            {nick}
                          </Link>
                        ) : (
                          <span
                            data-testid="admin-term-user"
                            className="block truncate text-sm font-bold text-foreground"
                          >
                            {nick}
                          </span>
                        )}
                        <p className="tabular-nums text-[11px] text-muted-foreground">
                          {absoluteDate(t.startedAt)} — {t.endedAt ? absoluteDate(t.endedAt) : '至今'}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </section>

      {/* ====================================================================
          竖向发光编年史时间轴
         ==================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold text-foreground">事件编年史</h2>
          <Segmented
            size="sm"
            value={category}
            onChange={setCategory}
            options={[
              { value: 'all', label: '全部', testId: 'history-filter-all' },
              { value: 'milestone', label: '大事记', testId: 'history-filter-milestone' },
              { value: 'moderation', label: '治理记录', testId: 'history-filter-moderation' },
            ]}
          />
        </div>

        {history.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : history.isError ? (
          <Empty
            testId="history-error"
            title="社群历史加载失败"
            description="请稍后重试。"
          />
        ) : events.length === 0 ? (
          <Empty
            testId="history-empty"
            title="该分类下暂无历史记录"
            description="社群的每一次重大变更与治理动作都会永久记录在此。"
            icon={<History className="h-5 w-5" />}
          />
        ) : (
          <div data-testid="community-history-list" className="relative pl-6 sm:pl-8">
            {/* 竖向极光发光主光束 */}
            <div
              aria-hidden="true"
              className="absolute top-2 bottom-2 left-2.5 w-[2px] rounded-full sm:left-3.5"
              style={{
                background:
                  'linear-gradient(180deg, var(--aurora-1), var(--aurora-2) 55%, var(--aurora-3) 90%, transparent)',
                opacity: 0.75,
              }}
            />

            <div className="space-y-4">
              {events.map((ev, idx) => {
                const meta = EVENT_META[ev.eventType ?? ''] ?? {
                  label: ev.eventType ?? '事件',
                  gradient: chroma.gradient,
                  icon: UserCheck,
                }
                const Icon = meta.icon
                const operator = pickAuthor(users, ev.operatorId)
                const target = pickAuthor(users, ev.targetUserId)

                return (
                  <motion.div
                    key={ev.id ?? String(idx)}
                    data-testid="history-item"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.3) }}
                    className="relative"
                  >
                    {/* 发光光束节点 */}
                    <span
                      className="absolute top-5 -left-[25px] flex h-6 w-6 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-[var(--bg-canvas)] sm:-left-[29px]"
                      style={{ background: meta.gradient }}
                    >
                      <Icon className="h-3 w-3" />
                    </span>

                    <Card padding="sm" className="rounded-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          data-testid="history-event-type"
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
                          style={{ background: meta.gradient }}
                        >
                          {meta.label}
                        </span>
                        <span className="tabular-nums font-mono text-[11px] text-muted-foreground">
                          {absoluteDateTime(ev.createdAt)}
                        </span>
                      </div>

                      {ev.detail && (
                        <p
                          data-testid="history-detail"
                          className="mt-2.5 text-sm leading-relaxed text-foreground"
                        >
                          {ev.detail}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {ev.operatorId && (
                          <span data-testid="history-operator" className="inline-flex items-center gap-1.5">
                            <span>操作人：</span>
                            <Link
                              to={`/u/${encodeURIComponent(ev.operatorId)}`}
                              className="font-semibold text-secondary-foreground hover:text-primary"
                            >
                              {operator?.nickname ?? `用户 #${ev.operatorId.slice(-4)}`}
                            </Link>
                          </span>
                        )}
                        {ev.targetUserId && (
                          <span data-testid="history-target" className="inline-flex items-center gap-1.5">
                            <span>涉及成员：</span>
                            <Link
                              to={`/u/${encodeURIComponent(ev.targetUserId)}`}
                              className="font-semibold text-secondary-foreground hover:text-primary"
                            >
                              {target?.nickname ?? `用户 #${ev.targetUserId.slice(-4)}`}
                            </Link>
                          </span>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          </div>
        )}

        {history.hasNextPage && (
          <div className="pt-2 text-center">
            <Button
              variant="secondary"
              data-testid="btn-load-more-history"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? '加载中…' : '加载更早记录'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
