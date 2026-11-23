import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowUpRight, Clock, Filter, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useCommunityList } from '@/features/community/api'
import { useSearchPosts } from '@/features/search/api'
import type { SearchSort } from '@/features/search/api'
import { HighlightedText } from '@/features/search/highlight'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const sort: SearchSort = params.get('sort') === 'latest' ? 'latest' : 'relevance'
  const communityId = params.get('communityId') ?? ''

  const [draft, setDraft] = useState(q)
  const [prevQ, setPrevQ] = useState(q)
  if (q !== prevQ) {
    setPrevQ(q)
    setDraft(q)
  }

  const { data: commPage } = useCommunityList(null)
  const communities = commPage?.items ?? []

  const search = useSearchPosts({
    q,
    sort,
    communityId,
  })

  const items = search.data?.pages.flatMap((p) => p.items ?? []) ?? []

  const updateParams = (patch: { q?: string; sort?: SearchSort; communityId?: string }) => {
    const next = new URLSearchParams(params)
    if (patch.q !== undefined) {
      if (patch.q.trim()) next.set('q', patch.q.trim())
      else next.delete('q')
    }
    if (patch.sort !== undefined) {
      if (patch.sort === 'latest') next.set('sort', 'latest')
      else next.delete('sort')
    }
    if (patch.communityId !== undefined) {
      if (patch.communityId) next.set('communityId', patch.communityId)
      else next.delete('communityId')
    }
    setParams(next)
  }

  return (
    <div data-testid="search-page" className="mx-auto max-w-4xl space-y-6">
      {/* 搜索头卡片 */}
      <Card padding="lg" className="rounded-3xl">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <LuminousIcon
              size="md"
              gradient="linear-gradient(135deg, #22D3EE 0%, #8B5CF6 100%)"
            >
              <Search className="h-5 w-5" />
            </LuminousIcon>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
              全站<span className="text-aurora">搜索</span>
            </h1>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              updateParams({ q: draft })
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <div className="relative flex flex-1 items-center rounded-2xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-4 focus-within:border-[rgba(var(--accent-rgb),0.65)] focus-within:ring-2 focus-within:ring-[var(--ring-glow)]">
              <Search className="mr-2.5 h-4 w-4 text-primary" />
              <input
                type="search"
                data-testid="search-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入关键词，例如：牛排、微前端、摄影…"
                maxLength={100}
                className="h-11 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <Button type="submit" size="lg" className="shrink-0">
              <Sparkles className="h-4 w-4" />
              搜索
            </Button>
          </form>

          {/* 筛选与排序条 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                data-testid="search-community-select"
                value={communityId}
                onChange={(e) => updateParams({ communityId: e.target.value })}
                aria-label="按社群筛选"
                className="h-9 cursor-pointer rounded-xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-3 text-xs font-medium text-foreground focus:border-[rgba(var(--accent-rgb),0.65)] focus:outline-none"
              >
                <option value="">全部社群</option>
                {communities.map((c) => (
                  <option key={c.id} value={c.id ?? ''}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <Segmented
              size="sm"
              value={sort}
              onChange={(next) => updateParams({ sort: next })}
              options={[
                { value: 'relevance', label: '按相关度', testId: 'search-sort-relevance' },
                { value: 'latest', label: '按最新', testId: 'search-sort-latest' },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* 结果区 */}
      {!q ? (
        <Empty
          testId="search-hint"
          title="输入关键词搜索帖子"
          description="按 ⌘K 也可随时全局搜索。"
          icon={<Search className="h-5 w-5" />}
        />
      ) : search.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : search.isError ? (
        <Empty
          testId="search-error"
          title="搜索暂时不可用"
          description="请稍后重试。"
          action={
            <Button
              variant="secondary"
              data-testid="search-retry"
              onClick={() => void search.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              重试搜索
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <Empty
          testId="search-empty"
          title={`未找到与「${q}」匹配的帖子`}
          description="尝试更换更简短的关键词，或清除社群筛选条件。"
          icon={<Search className="h-5 w-5" />}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <p data-testid="search-count" className="text-xs font-medium text-muted-foreground">
              已加载 <span className="tabular-nums font-bold text-foreground">{String(items.length)}</span> 条相关结果
              {search.hasNextPage ? '（还有更多）' : ''}
            </p>
          </div>

          <div data-testid="search-result-list" className="space-y-3">
            {items.map((item, idx) => {
              const commName = item.communityName ?? ''
              const chroma = getCommunityChroma(commName)
              const href =
                commName && item.postId
                  ? `/c/${encodeURIComponent(commName)}/p/${encodeURIComponent(item.postId)}`
                  : '#'

              return (
                <motion.div
                  key={item.postId}
                  data-testid="search-result-item"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.25) }}
                >
                  <Link to={href} className="block">
                    <Card padding="md" className="group transition-transform hover:-translate-y-0.5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {commName && (
                              <span
                                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                                style={{ background: chroma.gradient }}
                              >
                                #{commName}
                              </span>
                            )}
                            {item.authorNickname && (
                              <span className="font-medium text-secondary-foreground">
                                {item.authorNickname}
                              </span>
                            )}
                            <span className="tabular-nums inline-flex items-center gap-1 text-[11px]">
                              <Clock className="h-3 w-3" />
                              {relativeTime(item.createdAt)}
                            </span>
                          </div>

                          <h2 className="font-display text-base font-bold leading-snug text-foreground transition-colors group-hover:text-primary">
                            <HighlightedText text={item.titleHighlight || item.title} />
                          </h2>

                          {item.bodySnippet && (
                            <p className="line-clamp-2 text-xs leading-relaxed text-secondary-foreground">
                              <HighlightedText text={item.bodySnippet} stripMarkdown />
                            </p>
                          )}
                        </div>

                        <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              )
            })}
          </div>

          {search.hasNextPage && (
            <div className="pt-2 text-center">
              <Button
                variant="secondary"
                data-testid="search-load-more"
                disabled={search.isFetchingNextPage}
                onClick={() => void search.fetchNextPage()}
              >
                {search.isFetchingNextPage ? '加载更多中…' : '加载更多结果'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
