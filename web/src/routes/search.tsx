import { Link, useSearchParams } from 'react-router'
import { useCommunityList } from '@/features/community/api'
import { useSearchPosts, type SearchItem, type SearchSort } from '@/features/search/api'
import { HighlightedText } from '@/features/search/highlight'
import { ApiError } from '@/shared/api/api-error'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Group, groupRowClass } from '@/shared/ui/group'
import { Pill } from '@/shared/ui/pill'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

/**
 * 栏宽与顶栏一致；底色 #f5f5f7 是 inset grouped 的前提。
 */
const CONTAINER = 'mx-auto w-full max-w-[980px] px-6 pb-24 pt-12'

/**
 * 全站搜索页（p6-search.md §6）。
 *
 * ## 状态住在 URL 里
 *
 * `q / sort / communityId` 的唯一来源是查询参数，组件内部不另存一份。
 * 这样刷新能还原、链接能分享、浏览器后退就是"上一个搜索"，
 * 而且不需要写任何"同步 URL 与 state"的胶水代码（那类代码一定会有一条路径漏掉）。
 *
 * `cursor` 刻意**不进 URL**：它是分页实现细节，属于 useInfiniteQuery 的 pageParam。
 * 把它放进 URL 会让"刷新"变成"回到第三页"，而用户刷新时想要的是重新看第一页。
 *
 * ## 输入框是非受控的
 *
 * 输入框用 `key={q}` + `defaultValue`：URL 变了就重新挂载，自然取到新值。
 * 只有提交（回车 / 点搜索）才写 URL。输入即写会让每次按键都产生一条历史记录；
 * 而把 URL 用 effect 同步进 state 又多一轮渲染，且永远有一条路径会被漏写。
 *
 * ## 高亮是切分，不是注入
 *
 * 后端只给 `\uE000...\uE001` 包裹的文本，`HighlightedText` 切成文本与 `<mark>`。
 * 全站唯一的危险 API（dangerouslySetInnerHTML）不该为了一个搜索结果页破例。
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const sort: SearchSort = params.get('sort') === 'latest' ? 'latest' : 'relevance'
  const communityId = params.get('communityId') ?? ''

  const communities = useCommunityList(null)
  const query = useSearchPosts({ q, sort, communityId })
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])
  const hasNextPage = query.hasNextPage

  /** 三个参数一起写：任何一个没写都会被当成"被清空"，状态就丢了 */
  const apply = (next: { q: string; sort: SearchSort; communityId: string }) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    sp.set('sort', next.sort)
    if (next.communityId) sp.set('communityId', next.communityId)
    setParams(sp)
  }

  const submit = (form: HTMLFormElement) => {
    const raw = new FormData(form).get('q')
    apply({ q: typeof raw === 'string' ? raw.trim() : '', sort, communityId })
  }

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] bg-surface" data-testid="search-page">
      <div className={CONTAINER}>
        <header className="mb-8">
          <h1 className="m-0 text-title">搜索</h1>
          <p className="m-0 mt-2 max-w-[38rem] text-aux leading-[1.7] text-muted-foreground">
            标题、正文、作者昵称与社群名一起参与匹配，命中的词会高亮。
          </p>
        </header>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            submit(e.currentTarget)
          }}
          className="mb-5 flex items-center gap-2.5"
        >
          <div
            className={cn(
              'flex h-12 min-w-0 flex-1 items-center rounded-full bg-background px-5',
              'shadow-[var(--shadow-soft)]',
              'transition-[background-color,box-shadow] duration-[var(--duration-fast)]',
              'focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)]',
            )}
          >
            <input
              key={q}
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索帖子、社群、作者"
              aria-label="搜索关键词"
              maxLength={100}
              data-testid="search-input"
              className="min-w-0 flex-1 bg-transparent text-read text-foreground outline-none placeholder:text-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          <Button type="submit" size="md">
            搜索
          </Button>
        </form>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Segmented
            value={sort}
            onChange={(v) => apply({ q, sort: v, communityId })}
            options={[
              { value: 'relevance', label: '相关性', testId: 'search-sort-relevance' },
              { value: 'latest', label: '最新', testId: 'search-sort-latest' },
            ]}
          />

          {/* 社群下拉：复用已有的社群列表接口（limit 默认 20），不新增端点 */}
          <span className="relative inline-flex items-center">
            <select
              value={communityId}
              onChange={(e) => apply({ q, sort, communityId: e.target.value })}
              aria-label="按社群筛选"
              data-testid="search-community-select"
              className={cn(
                'h-9 max-w-[15rem] cursor-pointer appearance-none rounded-full bg-background pl-4 pr-9 text-aux text-foreground',
                'transition-shadow duration-[var(--duration-fast)]',
                'focus:outline-none focus:shadow-[0_0_0_3px_var(--color-primary-soft)]',
                communityId ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              <option value="">全部社群</option>
              {(communities.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute right-4 h-[7px] w-[7px] -translate-y-0.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-faint"
            />
          </span>

          {q && !query.isPending && !query.isError ? (
            <span className="text-caption text-faint" data-testid="search-count">
              已加载 {items.length} 条
              {hasNextPage ? '' : ' · 已到末页'}
            </span>
          ) : null}
        </div>

        {!q ? (
          <Group>
            <Empty
              testId="search-hint"
              title="输入关键词开始搜索"
              description={
                <>
                  搜索会同时匹配标题、正文、作者昵称和社群名。
                  <br />
                  可以先搜一个你关心的词，再用上方的社群下拉收窄范围。
                </>
              }
            />
          </Group>
        ) : query.isPending ? (
          <Group>
            <ul className="m-0 list-none p-0" aria-label="加载中">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="px-4 py-4">
                  <Skeleton className="mb-2 block h-[17px] w-[58%]" />
                  <Skeleton className="mb-2 block h-3.5 w-[86%]" />
                  <Skeleton className="block h-3 w-[32%]" />
                </li>
              ))}
            </ul>
          </Group>
        ) : query.isError ? (
          <Group>
            <div className="px-6 py-14 text-center" data-testid="search-error">
              <p className="m-0 mb-2 text-read font-semibold text-foreground">
                {errorTitle(query.error)}
              </p>
              <p className="m-0 mb-6 text-aux leading-[1.7] text-muted-foreground">
                {errorHint(query.error)}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
                data-testid="search-retry"
              >
                重试
              </Button>
            </div>
          </Group>
        ) : items.length === 0 ? (
          <Group>
            <Empty
              testId="search-empty"
              title={`没有找到与「${q}」相关的帖子`}
              description={
                <>
                  索引是准实时的：刚发的帖子可能要几秒钟才搜得到。
                  <br />
                  换个更短的关键词，或者把社群筛选放宽试试。
                </>
              }
            />
          </Group>
        ) : (
          <>
            <Group>
              <ul className="m-0 list-none p-0" data-testid="search-result-list">
                {items.map((item) => (
                  <li
                    key={item.postId}
                    data-testid="search-result-item"
                    className={groupRowClass({ className: 'p-0' })}
                  >
                    <ResultRow item={item} />
                  </li>
                ))}
              </ul>
            </Group>

            {hasNextPage ? (
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                data-testid="search-load-more"
                className="mt-3 w-full py-3.5 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground disabled:opacity-50"
              >
                {query.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 一条结果。
 *
 * **社群名为空时不可点**：详情页的路由是 `/c/{社群名}/p/{id}`，拼不出来。
 * 索引里的 `communityName` 是发帖时的反范式快照，正常不会缺；缺了就退化成纯文本，
 * 比点进 404 诚实。
 */
function ResultRow({ item }: { item: SearchItem }) {
  const href = item.communityName
    ? `/c/${encodeURIComponent(item.communityName)}/p/${item.postId ?? ''}`
    : null

  const body = (
    <div className="w-full px-4 py-3.5">
      <p className="m-0 text-read font-medium leading-[1.45] tracking-[-0.01em] text-foreground transition-colors duration-[var(--duration-fast)] group-hover:text-primary">
        {/* 后端已保证 titleHighlight 在未命中时回落为 title；这里再兜一层 */}
        <HighlightedText text={item.titleHighlight ?? item.title ?? '（无标题）'} />
      </p>
      {item.bodySnippet ? (
        <p className="m-0 mt-1.5 line-clamp-2 text-aux leading-[1.7] text-muted-foreground">
          <HighlightedText text={item.bodySnippet} />
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-faint">
        {item.communityName ? <Pill>{item.communityName}</Pill> : null}
        {item.authorNickname ? <span>{item.authorNickname}</span> : null}
        {item.authorNickname ? <span>·</span> : null}
        <span>{relativeTime(item.createdAt)}</span>
      </div>
    </div>
  )

  if (!href) return <div className="w-full">{body}</div>
  return (
    <Link to={href} className="group block w-full">
      {body}
    </Link>
  )
}

/** 50300 / 503 是"搜索服务降级"，不是"你的搜索写法有问题"，文案必须区分 */
function errorTitle(err: unknown): string {
  if (err instanceof ApiError && (err.status === 503 || err.code === 50300)) {
    return '搜索服务暂时不可用'
  }
  return '搜索没有完成'
}

function errorHint(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === 50300) {
      return '索引服务正在重启或过载，稍等一下再试。站内其他页面不受影响。'
    }
    if (err.code === 40010) return '搜索条件不合法：把关键词改短一点，或重新选一次社群。'
    if (err.status === 0) return '网络不可达，请检查连接后重试。'
    return err.message || '请稍后重试。'
  }
  return '请稍后重试。'
}
