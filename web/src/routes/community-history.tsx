import { useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  useCommunityAdminHistory,
  useCommunityDetail,
  useCommunityHistory,
  type HistoryCategory,
} from '@/features/community/api'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Avatar } from '@/shared/ui/avatar'
import { Empty } from '@/shared/ui/empty'
import { Group, GroupHeader, groupRowClass } from '@/shared/ui/group'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { absoluteDate, absoluteDateTime } from '@/shared/lib/time'

/**
 * 事件类型的展示名。
 *
 * 映射写在**前端**而不是让后端直接返回中文：category 与 eventType 是契约里稳定的
 * 机器可读值，文案属于展示层。未知类型不隐藏，退化成原始 code ——
 * 后端加了一种事件而前端还没跟上时，编年史不该整条消失。
 */
const EVENT_LABEL: Record<string, string> = {
  COMMUNITY_CREATED: '社群创建',
  ADMIN_TRANSFERRED: '管理员转让',
  INFO_UPDATED: '信息更新',
  MEMBER_BANNED: '封禁成员',
  MEMBER_UNBANNED: '解除封禁',
}

const FILTERS: Array<{ value: HistoryCategory; label: string; testId: string }> = [
  { value: 'all', label: '全部', testId: 'history-filter-all' },
  { value: 'milestone', label: '大事记', testId: 'history-filter-milestone' },
  { value: 'moderation', label: '治理记录', testId: 'history-filter-moderation' },
]

/**
 * 社群历史（公开路由 `/c/:name/history`）。
 *
 * 三件事决定了它的形状：
 *
 * 1. **游客可读**。编年史是社群的公共记忆，包括治理记录（谁因为什么被封）。
 *    因此这里没有 viewer 字段，也没有任何按登录态变化的分支。
 * 2. **单栏 980**，不套 `CommunityLayout` 的双栏：历史不是"在某个社群里读帖子"，
 *    它是这个社群的档案，左栏的帖子列表在这里只会分散注意力。
 * 3. **两个请求各自独立**：历任管理员不分页（任数量级是个位数），时间线游标分页。
 *    任一个挂了不该让另一个也空着。
 */
export function CommunityHistoryPage() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const [category, setCategory] = useState<HistoryCategory>('all')
  const adminHistory = useCommunityAdminHistory(name)
  const history = useCommunityHistory(name, category)

  const terms = adminHistory.data?.items ?? []
  const events = (history.data?.pages ?? []).flatMap((p) => p.items ?? [])

  // 操作人 / 对象 / 历任管理员的昵称头像一次取完：一屏 N 条 = 1 个请求，
  // 不逐条查（那是 N+1，也是 p55-social.md §7 明确否掉的写法）。
  const summaries = useUserSummaries([
    ...terms.map((t) => t.userId),
    ...events.flatMap((e) => [e.operatorId, e.targetUserId]),
  ])
  const nameOf = (userId: string | undefined) =>
    pickAuthor(summaries.data, userId)?.nickname ?? (summaries.isPending ? '…' : '已注销用户')
  const avatarOf = (userId: string | undefined) =>
    pickAuthor(summaries.data, userId)?.avatarUrl ?? null

  const communityName = detail.data?.name ?? name ?? ''

  return (
    <div
      className="min-h-[calc(100vh-var(--topbar-h))] bg-surface"
      data-testid="community-history-page"
    >
      <div className="mx-auto w-full max-w-[980px] px-6 pb-24 pt-12">
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline"
          data-testid="history-back-link"
        >
          ← 返回 {communityName}
        </Link>

        <header className="mt-5 mb-10">
          <h1 className="m-0 text-title" data-testid="history-title">
            {communityName}的历史
          </h1>
          <p className="m-0 mt-2 max-w-[38rem] text-read text-muted-foreground">
            谁在这里当过管理员，以及发生过什么。全部公开可读。
          </p>
        </header>

        {/* ---------------- 历代管理员 ---------------- */}
        <section className="mb-12">
          <GroupHeader className="px-1">历代管理员</GroupHeader>
          <Group data-testid="admin-history-section">
            {adminHistory.isPending ? (
              <div className="px-4 py-4">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : adminHistory.isError ? (
              <p className="m-0 px-4 py-4 text-aux text-danger">
                {authErrorMessage(adminHistory.error)}
              </p>
            ) : terms.length === 0 ? (
              <Empty title="还没有管理员记录" description="历任管理员由建社与转让事件推导。" />
            ) : (
              <ul className="m-0 list-none p-0">
                {terms.map((t) => (
                  <li
                    key={`${String(t.term)}-${t.userId ?? ''}`}
                    className={groupRowClass()}
                    data-testid="admin-term-item"
                  >
                    <span className="w-14 shrink-0 text-caption tabular-nums text-faint">
                      第 {t.term ?? 1} 任
                    </span>
                    <Link
                      to={`/u/${encodeURIComponent(t.userId ?? '')}`}
                      className="inline-flex min-w-0 items-center gap-2.5 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
                      data-testid="admin-term-user"
                    >
                      <Avatar url={avatarOf(t.userId)} name={nameOf(t.userId)} size={32} />
                      <span className="truncate text-body font-medium text-foreground">
                        {nameOf(t.userId)}
                      </span>
                    </Link>
                    {t.current ? (
                      <span
                        className="inline-flex h-[20px] shrink-0 items-center rounded-full bg-fill px-2 text-caption font-medium text-muted-foreground"
                        data-testid="admin-term-current"
                      >
                        现任
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-caption tabular-nums text-faint">
                      {absoluteDate(t.startedAt)}
                      {' — '}
                      {t.current ? '至今' : absoluteDate(t.endedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </section>

        {/* ---------------- 时间线 ---------------- */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <h2 className="m-0 text-sub font-semibold">社群时间线</h2>
            {/* 切筛选 = 换一个 query（游标绑定分类），不用清空已有列表手忙脚乱 */}
            <Segmented value={category} onChange={setCategory} options={FILTERS} />
          </div>

          <Group>
            {history.isPending ? (
              <div className="space-y-2 px-4 py-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : history.isError ? (
              <p className="m-0 px-4 py-4 text-aux text-danger" data-testid="history-error">
                {authErrorMessage(history.error)}
              </p>
            ) : events.length === 0 ? (
              <Empty
                title="还没有这一类的记录"
                description={
                  category === 'moderation'
                    ? '封禁与解封会出现在这里。'
                    : category === 'milestone'
                      ? '建社、转让管理员、改信息会出现在这里。'
                      : '社群发生的事会按时间倒序记在这里。'
                }
                testId="history-empty"
              />
            ) : (
              <ul className="m-0 list-none p-0" data-testid="community-history-list">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className={groupRowClass({ className: 'flex-col items-start gap-1.5 py-4' })}
                    data-testid="history-item"
                  >
                    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-caption text-faint">
                      <Pill data-testid="history-event-type">
                        {EVENT_LABEL[e.eventType ?? ''] ?? e.eventType ?? '事件'}
                      </Pill>
                      <span>操作人</span>
                      <Link
                        to={`/u/${encodeURIComponent(e.operatorId ?? '')}`}
                        className="text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline"
                        data-testid="history-operator"
                      >
                        {nameOf(e.operatorId)}
                      </Link>
                      {e.targetUserId ? (
                        <>
                          <span>·</span>
                          <span>对象</span>
                          <Link
                            to={`/u/${encodeURIComponent(e.targetUserId)}`}
                            className="text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline"
                            data-testid="history-target"
                          >
                            {nameOf(e.targetUserId)}
                          </Link>
                        </>
                      ) : null}
                      {/* 编年史用绝对时间：这里要的是"哪天发生的"，不是"多久以前" */}
                      <span className="ml-auto shrink-0 tabular-nums">
                        {absoluteDateTime(e.createdAt)}
                      </span>
                    </div>
                    {e.detail ? (
                      <p
                        className="m-0 break-words text-body leading-[1.75] text-foreground"
                        data-testid="history-detail"
                      >
                        {e.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Group>

          {history.hasNextPage ? (
            <button
              type="button"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
              className="mt-2 w-full rounded-full py-3 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-fill hover:text-foreground disabled:opacity-50"
              data-testid="btn-load-more-history"
            >
              {history.isFetchingNextPage ? '加载中…' : '加载更多'}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  )
}
