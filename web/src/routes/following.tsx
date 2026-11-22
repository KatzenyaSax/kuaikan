import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useCommunityList } from '@/features/community/api'
import { useAuthorPosts, usePostsByAuthors, type PostSummary } from '@/features/content/api'
import { FeedLoadMore, PostFeedRow } from '@/features/content/post-feed'
import { useSession } from '@/features/auth/session'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useMyFollowing } from '@/features/social/api'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Group, GroupHeader, groupRowClass } from '@/shared/ui/group'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/lib/cn'

/**
 * 页面外壳。底色是 #f5f5f7（inset grouped 的前提），栏宽与顶栏一致。
 *
 * 三个分支（正在续期 / 游客 / 已登录）共用同一个外壳：状态落地时只换内容，
 * 不换底色，否则会闪一下白→灰。
 */
function Page({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-[calc(100vh-var(--topbar-h))] bg-surface"
      data-testid="following-page"
    >
      <div className="mx-auto w-full max-w-[980px] px-6 pb-24 pt-12">{children}</div>
    </div>
  )
}

/** 产品页标题：大标题 + 一行副标题，左对齐。三个分支（正在续期 / 游客 / 已登录）共用 */
function PageHeader({ subtitle = '你关注的人发的帖子，按时间排序。' }: { subtitle?: string }) {
  return (
    <header className="mb-10">
      <h1 className="m-0 text-title">关注</h1>
      <p className="m-0 mt-2 max-w-[38rem] text-read text-muted-foreground">{subtitle}</p>
    </header>
  )
}

/**
 * 关注流（P5.5.2）。
 *
 * ## 读路径零跨服务调用
 *
 * 三个请求就够：我关注的人 / 这些人发的帖子 / 社群列表（映射社群里）。
 * 作者昵称头像直接用「我关注的人」这份 Map，**不再发 `/users?ids=`**
 * ——那正是 ADR 0005 要避免的重复聚合。
 *
 * ## 游客不发任何需要登录的请求
 *
 * `/following` 是本项目第一个"游客进来必然空"的页面。
 * 这里在**未登录时直接渲染引导态**，`useMyFollowing(false)` 根本不会发请求 ——
 * 靠 401 再弹提示会制造一次无意义的续期/登出噪音（p55-social.md §6.1）。
 *
 * ## 双栏
 *
 * 980px（与顶栏同宽）：左栏 272px（inset grouped 的「全部关注」+ 已关注的人），
 * 右栏时间线靠 hairline 分隔。窄屏不隐藏任何一栏，而是上下堆叠，
 * 因为窄屏用户更需要"我还关注了谁"这个信息。
 */
export function FollowingPage() {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  // 未登录时不发请求：enabled=false 让这个 hook 完全静默
  const myFollowing = useMyFollowing(authed)
  const communities = useCommunityList(null)
  const [selected, setSelected] = useState<string | null>(null)

  const users = myFollowing.data ?? []
  // 关注关系变了（取关了自己正在看的作者）时自动回落到「全部关注」，
  // 而不是停在一个已经不在列表里的空筛选上
  const selectedUser = selected ? (users.find((u) => u.userId === selected) ?? null) : null
  const selectedId = selectedUser?.userId ?? null

  const nameById = new Map(
    (communities.data?.items ?? []).map((c) => [c.id ?? '', c.name ?? '']),
  )

  if (status === 'unknown') {
    // AuthBootstrap 还在静默续期：**既不是游客也不是已登录**。
    // 这里如果落进下面的 !authed 分支，已登录用户直接刷新 /following 会先闪一下
    // “登录后查看…”，而那个提示对他是错的。所以只渲染骨架，等状态落地。
    return (
      <Page>
        <PageHeader />
        <div className="flex flex-col gap-6 md:flex-row md:gap-7">
          <div className="w-full shrink-0 md:w-[272px]">
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="mb-2 h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </Page>
    )
  }

  if (status === 'anonymous') {
    return (
      <Page>
        <PageHeader subtitle="登录后，这里按时间倒序显示你关注的人发的帖子。" />
        <Empty
          title="登录后查看你关注的人的动态"
          description={
            <>
              关注是把「社群」之外的另一种订阅方式：你只关心某几个人时用它。
              <br />
              登录后，左边是你关注的人，右边是他们发的帖子。
            </>
          }
          testId="following-login-hint"
          action={
            <Link to="/login?returnTo=%2Ffollowing">
              <Button size="sm">去登录</Button>
            </Link>
          }
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader />

      {myFollowing.isPending ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-7">
          <div className="w-full shrink-0 md:w-[272px]">
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="mb-2 h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      ) : myFollowing.isError ? (
        <p className="m-0 text-body text-danger" data-testid="following-error">
          {authErrorMessage(myFollowing.error)}
        </p>
      ) : users.length === 0 ? (
        <Empty
          title="你还没有关注任何人"
          description={
            <>
              关注之后，这里会按时间倒序显示他们发的帖子。
              <br />
              可以先从社群里找到感兴趣的人。
            </>
          }
          testId="following-empty"
          action={
            <Link to="/c">
              <Button size="sm">去社群逛逛</Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8 md:flex-row md:gap-7">
          {/* 左栏：272px，inset grouped（白面 + 内缩 hairline），不用边框围成表格 */}
          <aside className="w-full shrink-0 md:w-[272px]" data-testid="following-left">
            <GroupHeader className="px-0 pb-2.5">我关注的人</GroupHeader>
            <Group>
              <ul className="m-0 list-none p-0">
                <li
                  className={groupRowClass({
                    className: cn('p-0', selectedId === null && 'bg-fill'),
                  })}
                >
                  <SelectRow
                    active={selectedId === null}
                    onClick={() => setSelected(null)}
                    testId="following-all"
                  >
                    <span className="truncate font-medium">全部关注（{users.length}）</span>
                  </SelectRow>
                </li>
                {users.map((u) => {
                  const id = u.userId ?? ''
                  return (
                    <li
                      key={id}
                      className={groupRowClass({
                        className: cn('gap-1 p-0', selectedId === id && 'bg-fill'),
                      })}
                    >
                      <SelectRow
                        active={selectedId === id}
                        onClick={() => setSelected(id)}
                        testId="following-user-item"
                        className="min-w-0 flex-1"
                      >
                        <Avatar url={u.avatarUrl ?? null} name={u.nickname ?? ''} size={24} />
                        <span className="truncate">{u.nickname ?? '已注销用户'}</span>
                      </SelectRow>
                      {/* 单独的主页入口：点名字是"筛选右栏"，点这里才是"进他主页" */}
                      <Link
                        to={`/u/${encodeURIComponent(id)}`}
                        className="shrink-0 pr-4 text-caption text-faint transition-colors duration-[var(--duration-fast)] hover:text-foreground"
                        title="进入 ta 的主页"
                        data-testid="following-user-profile"
                      >
                        主页
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Group>
          </aside>

          {/* 右栏：时间线 */}
          <section className="min-w-0 flex-1" data-testid="following-right">
            <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-3">
              <h2 className="m-0 text-sub font-semibold">
                {selectedUser ? (selectedUser.nickname ?? 'ta') : '全部关注'}
              </h2>
              {selectedUser ? (
                <Link
                  to={`/u/${encodeURIComponent(selectedUser.userId ?? '')}`}
                  className="text-aux text-primary hover:underline"
                  data-testid="following-view-profile"
                >
                  查看主页 →
                </Link>
              ) : (
                <span className="text-aux text-muted-foreground">共 {users.length} 人</span>
              )}
            </div>

            <Group>
              {selectedUser ? (
                <AuthorFeed
                  // key：换人时重新挂载，分页状态与缓存游标自然归零
                  key={selectedUser.userId ?? ''}
                  userId={selectedUser.userId ?? ''}
                  communityNameById={nameById}
                />
              ) : (
                <AllFollowingFeed
                  authorIds={users.map((u) => u.userId ?? '').filter(Boolean)}
                  authorNameById={new Map(users.map((u) => [u.userId ?? '', u.nickname ?? '']))}
                  communityNameById={nameById}
                />
              )}
            </Group>
          </section>
        </div>
      )}
    </Page>
  )
}

/** 左栏的一行：整体可点，选中态用浅底 + 字重，不用颜色 */
function SelectRow({
  active,
  onClick,
  testId,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  testId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 px-4 py-3 text-left text-aux transition-colors duration-[var(--duration-fast)] hover:bg-fill',
        active ? 'font-semibold text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 「全部关注」时间线：一次 POST 带上全部 authorIds（单人上限 200，正好一次取全） */
function AllFollowingFeed({
  authorIds,
  authorNameById,
  communityNameById,
}: {
  authorIds: string[]
  authorNameById: Map<string, string>
  communityNameById: Map<string, string>
}) {
  const query = usePostsByAuthors(authorIds)
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])
  return (
    <PostFeed
      query={query}
      items={items}
      authorNameById={authorNameById}
      communityNameById={communityNameById}
      emptyText="你关注的人还没有发过帖子"
      testId="following-posts"
    />
  )
}

/** 单人时间线：GET /posts?authorId=，与用户主页「帖子」Tab 是同一个端点 */
function AuthorFeed({
  userId,
  communityNameById,
}: {
  userId: string
  communityNameById: Map<string, string>
}) {
  const query = useAuthorPosts(userId)
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])
  return (
    <PostFeed
      query={query}
      items={items}
      communityNameById={communityNameById}
      emptyText="ta 还没有发过帖子"
      testId="following-author-posts"
    />
  )
}

/**
 * 帖子流（两条线的共同外壳）。
 *
 * 只把「列表 + 加载更多 + 三种状态」抽出来，数据源留在上面两个组件里：
 * 一个走 POST 批量、一个走 GET 单人，硬揉成一个 hook 会让参数变成一堆可选开关。
 */
function PostFeed({
  query,
  items,
  authorNameById,
  communityNameById,
  emptyText,
  testId,
}: {
  query: ReturnType<typeof usePostsByAuthors>
  items: PostSummary[]
  authorNameById?: Map<string, string>
  communityNameById: Map<string, string>
  emptyText: string
  testId: string
}) {
  if (query.isPending) {
    return (
      <div className="pt-4">
        <Skeleton className="mb-3 h-14 w-full" />
        <Skeleton className="mb-3 h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <p className="py-8 text-aux text-danger" data-testid={`${testId}-error`}>
        {authErrorMessage(query.error)}
      </p>
    )
  }
  if (items.length === 0) {
    return <Empty title={emptyText} testId={`${testId}-empty`} />
  }
  return (
    <div data-testid={testId}>
      <ul className="m-0 list-none p-0">
        {items.map((p) => (
          <li key={p.id} className={groupRowClass({ interactive: true })}>
            <PostFeedRow
              post={p}
              communityName={communityNameById.get(p.communityId ?? '')}
              authorName={
                authorNameById && p.authorId ? (authorNameById.get(p.authorId) ?? undefined) : undefined
              }
            />
          </li>
        ))}
      </ul>
      <FeedLoadMore
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
      />
    </div>
  )
}
