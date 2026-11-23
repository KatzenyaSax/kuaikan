import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { Layers, Plus, Search, Users } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useCommunityList, useMyCommunities } from '@/features/community/api'
import { CreateCommunityDialog } from '@/features/community/create-community-dialog'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Input } from '@/shared/ui/field'
import { Skeleton } from '@/shared/ui/skeleton'

export function CommunityLanding() {
  const status = useSession((s) => s.status)
  const isAuth = status === 'authenticated'
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const allComms = useCommunityList(null)
  const myComms = useMyCommunities(isAuth)

  const items = (allComms.data?.items ?? []).filter((c) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return (
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    )
  })

  const joined = myComms.data?.items ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <LuminousIcon size="lg">
            <Layers className="h-6 w-6" />
          </LuminousIcon>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            社群<span className="text-aurora">星系</span>
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative w-52 sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选社群…"
              className="pl-9"
            />
          </div>
          {isAuth && (
            <Button data-testid="btn-new-community" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              创建社群
            </Button>
          )}
        </div>
      </div>

      {/* 我已加入的社群快览带 */}
      {isAuth && joined.length > 0 && !filter.trim() && (
        <section className="space-y-3">
          <h2 className="px-1 text-xs font-bold tracking-wider text-muted-foreground uppercase">
            我已加入 ({String(joined.length)})
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {joined.map((c) => {
              const name = c.name ?? ''
              const chroma = getCommunityChroma(name)
              return (
                <Link
                  key={c.id}
                  to={`/c/${encodeURIComponent(name)}`}
                  className="glass-panel inline-flex items-center gap-2.5 rounded-2xl px-3.5 py-2 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-[rgba(var(--accent-rgb),0.5)]"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: chroma.gradient }}
                  />
                  <span>{name}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {String(c.memberCount ?? 0)}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* 全部社群卡片网格 */}
      <section className="space-y-3">
        <h2 className="px-1 text-xs font-bold tracking-wider text-muted-foreground uppercase">
          全部社群 ({String(items.length)})
        </h2>

        {allComms.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-3xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty title="没有找到匹配的社群" description="换个关键词试试，或亲手创建一个新社群。" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c, idx) => {
              const name = c.name ?? ''
              const chroma = getCommunityChroma(name)
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx * 0.035, 0.28) }}
                >
                  <Link to={`/c/${encodeURIComponent(name)}`} className="block h-full">
                    <Card padding="none" className="group flex h-full flex-col overflow-hidden rounded-3xl transition-transform hover:-translate-y-1">
                      <div className="h-1.5 w-full" style={{ background: chroma.gradient }} />
                      <div className="flex flex-1 flex-col gap-3 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={name} src={c.avatarUrl} size="md" shape="rounded" />
                            <h3 className="truncate font-display text-base font-bold text-foreground group-hover:text-primary">
                              {name}
                            </h3>
                          </div>
                          <span className="tabular-nums inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
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
      </section>

      <CreateCommunityDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
