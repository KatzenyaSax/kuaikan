import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ExternalLink, LogIn, Sparkles, Users } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useAuthorPosts, usePostsByAuthors } from '@/features/content/api'
import { PostFeed } from '@/features/content/post-feed'
import { useMyFollowing } from '@/features/social/api'
import { Avatar } from '@/shared/ui/avatar'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/lib/cn'

export function FollowingPage() {
  const status = useSession((s) => s.status)
  const isAuth = status === 'authenticated'
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const myFollowing = useMyFollowing(isAuth)
  const followingUsers = useMemo(() => myFollowing.data ?? [], [myFollowing.data])
  const allAuthorIds = useMemo(
    () => followingUsers.map((u) => u.userId).filter((id): id is string => Boolean(id)),
    [followingUsers],
  )

  const selectedUser = useMemo(
    () => followingUsers.find((u) => u.userId === selectedUserId) ?? null,
    [followingUsers, selectedUserId],
  )

  const allFeed = usePostsByAuthors(selectedUserId ? [] : allAuthorIds)
  const singleFeed = useAuthorPosts(selectedUserId ?? undefined)

  if (!isAuth) {
    return (
      <div data-testid="following-page" className="mx-auto max-w-2xl py-10">
        <Empty
          testId="following-login-hint"
          title="登录以查看你的关注动态"
          description="关注感兴趣的创作者后，这里将按时间倒序汇聚他们发布的全部最新帖子，并支持按单人筛选。"
          icon={<Users className="h-5 w-5" />}
          action={
            <Link
              to="/login?returnTo=%2Ffollowing"
              className="btn-aurora inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-semibold"
            >
              <LogIn className="h-4 w-4" />
              立即登录
            </Link>
          }
        />
      </div>
    )
  }

  const allPosts = allFeed.data?.pages.flatMap((p) => p.items ?? []) ?? []
  const singlePosts = singleFeed.data?.pages.flatMap((p) => p.items ?? []) ?? []

  return (
    <div data-testid="following-page" className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3.5">
        <LuminousIcon
          size="lg"
          gradient="linear-gradient(135deg, #34D399 0%, #06B6D4 100%)"
        >
          <Users className="h-6 w-6" />
        </LuminousIcon>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            关注<span className="text-aurora">动态</span>
          </h1>
      </div>

      {myFollowing.isError ? (
        <div data-testid="following-error">
          <Empty
            title="关注列表加载失败"
            description="请检查网络或稍后重试。"
            action={
              <Button variant="secondary" onClick={() => void myFollowing.refetch()}>
                重新加载
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          {/* 左栏：我关注的人 */}
          <aside data-testid="following-left" className="lg:col-span-4">
            <Card padding="sm" className="sticky top-24 rounded-3xl">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  关注列表
                </span>
                <span className="tabular-nums text-xs font-semibold text-primary">
                  {String(followingUsers.length)} / 200
                </span>
              </div>

              {myFollowing.isPending ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="max-h-[64vh] space-y-1.5 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedUserId(null)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-all',
                      selectedUserId === null
                        ? 'btn-aurora text-white'
                        : 'border border-transparent text-secondary-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground',
                    )}
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span>全部关注</span>
                    <span className="tabular-nums ml-auto text-xs opacity-80">
                      {String(followingUsers.length)}
                    </span>
                  </button>

                  {followingUsers.map((u) => {
                    const active = selectedUserId === u.userId
                    const nick = u.nickname || '已注销用户'
                    return (
                      <button
                        key={u.userId}
                        type="button"
                        data-testid="following-user-item"
                        onClick={() => setSelectedUserId(u.userId ?? null)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all',
                          active
                            ? 'border-[rgba(var(--accent-rgb),0.45)] bg-[var(--color-primary-soft)] text-foreground'
                            : 'border-transparent text-secondary-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground',
                        )}
                      >
                        <Avatar name={nick} src={u.avatarUrl} size="sm" ring={active} />
                        <span className="truncate text-sm font-medium">{nick}</span>
                        {active && <ArrowRight className="ml-auto h-3.5 w-3.5 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>
          </aside>

          {/* 右栏：帖子流 */}
          <section data-testid="following-right" className="space-y-4 lg:col-span-8">
            {followingUsers.length === 0 && !myFollowing.isPending ? (
              <Empty
                title="你还没有关注任何人"
                description="去首页或社群里浏览帖子，点击作者旁的「关注」按钮，即可把 ta 的动态收进这里。"
                action={
                  <Link
                    to="/"
                    className="btn-aurora inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-semibold"
                  >
                    去发现画廊逛逛
                  </Link>
                }
              />
            ) : selectedUser ? (
              <div className="space-y-4">
                {/* 单人筛选头卡片 */}
                <Card
                  padding="sm"
                  data-testid="following-user-profile"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl"
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={selectedUser.nickname ?? '?'}
                      src={selectedUser.avatarUrl}
                      size="md"
                      ring
                    />
                    <div>
                      <p className="font-display text-base font-bold text-foreground">
                        {selectedUser.nickname}
                      </p>
                      <p className="text-xs text-muted-foreground">正在查看 ta 发布的帖子</p>
                    </div>
                  </div>
                  <Link
                    to={`/u/${encodeURIComponent(selectedUser.userId ?? '')}`}
                    data-testid="following-view-profile"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.5)] hover:text-primary"
                  >
                    <span>查看 ta 的主页</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Card>

                {singleFeed.isError ? (
                  <div data-testid="following-error">
                    <Empty title="帖子加载失败" description="请稍后重试。" />
                  </div>
                ) : (
                  <>
                    <PostFeed
                      posts={singlePosts}
                      isPending={singleFeed.isPending}
                      testId="following-author-posts"
                      emptyTitle="ta 还没有发过帖子"
                    />
                    {singleFeed.hasNextPage && (
                      <div className="text-center">
                        <Button
                          variant="secondary"
                          disabled={singleFeed.isFetchingNextPage}
                          onClick={() => void singleFeed.fetchNextPage()}
                        >
                          {singleFeed.isFetchingNextPage ? '加载中…' : '加载更多'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : allFeed.isError ? (
              <div data-testid="following-error">
                <Empty title="关注动态加载失败" description="请稍后重试。" />
              </div>
            ) : (
              <div className="space-y-4">
                <PostFeed
                  posts={allPosts}
                  isPending={allFeed.isPending}
                  testId="following-posts"
                  emptyTitle="关注的作者们最近还没有发帖"
                />
                {allFeed.hasNextPage && (
                  <div className="text-center">
                    <Button
                      variant="secondary"
                      disabled={allFeed.isFetchingNextPage}
                      onClick={() => void allFeed.fetchNextPage()}
                    >
                      {allFeed.isFetchingNextPage ? '加载中…' : '加载更多动态'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
