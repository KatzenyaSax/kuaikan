import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  ArrowRight,
  Edit3,
  Layers,
  UserCheck,
  Users,
} from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useUserCommunities } from '@/features/community/api'
import { useAuthorPosts } from '@/features/content/api'
import { PostFeed } from '@/features/content/post-feed'
import {
  useFollowersList,
  useFollowStates,
  useFollowingList,
  useUserProfile,
} from '@/features/social/api'
import { FollowButton } from '@/features/social/follow-button'
import { ApiError } from '@/shared/api/api-error'
import { getCommunityChroma, getUserChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Empty } from '@/shared/ui/empty'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'

type ProfileTab = 'posts' | 'communities' | 'following' | 'followers'

export function UserProfilePage() {
  const { userId } = useParams()
  const status = useSession((s) => s.status)
  const meId = useSession((s) => s.user?.userId)
  const isAuth = status === 'authenticated'
  const isMe = Boolean(meId && userId && meId === userId)

  const [tab, setTab] = useState<ProfileTab>('posts')

  const profileQuery = useUserProfile(userId)
  const { data: selfFollowMap } = useFollowStates([userId], isAuth && !isMe)
  const selfFollowState = userId ? selfFollowMap?.[userId] : undefined

  if (profileQuery.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <Skeleton className="h-52 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    )
  }

  if (profileQuery.isError || !profileQuery.data || !userId) {
    return (
      <div data-testid="user-profile-error" className="mx-auto max-w-2xl py-8">
        <Empty
          title="用户不存在或暂时无法加载"
          description={
            profileQuery.error instanceof ApiError
              ? profileQuery.error.message
              : '该用户主页暂时不可访问。'
          }
          action={
            <Link
              to="/"
              className="btn-aurora inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold"
            >
              返回首页
            </Link>
          }
        />
      </div>
    )
  }

  const p = profileQuery.data
  const nick = p.nickname ?? '未命名用户'
  const chroma = getUserChroma(nick)

  return (
    <div data-testid="user-profile-page" className="mx-auto max-w-4xl space-y-6">
      {/* 个人极光名片卡 */}
      <Card padding="none" className="overflow-hidden rounded-3xl">
        <div className="relative h-28 w-full" style={{ background: chroma.gradient }}>
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.34), transparent 55%)',
            }}
          />
        </div>

        <div className="px-6 pt-4 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="-mt-14 shrink-0 rounded-full bg-[var(--bg-canvas)] p-1.5 shadow-xl ring-1 ring-[var(--border-glass-strong)]">
                <Avatar name={nick} src={p.avatarUrl} size="xl" />
              </div>
              <div className="min-w-0 pb-0.5">
                <h1
                  data-testid="user-profile-nickname"
                  className="font-display text-2xl font-extrabold tracking-tight text-foreground"
                >
                  {nick}
                </h1>
                <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setTab('following')}
                    className="cursor-pointer transition-colors hover:text-foreground"
                  >
                    <strong
                      data-testid="user-profile-following-count"
                      className="tabular-nums font-bold text-foreground"
                    >
                      {String(p.followingCount ?? 0)}
                    </strong>{' '}
                    关注
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('followers')}
                    className="cursor-pointer transition-colors hover:text-foreground"
                  >
                    <strong
                      data-testid="user-profile-follower-count"
                      className="tabular-nums font-bold text-foreground"
                    >
                      {String(p.followerCount ?? 0)}
                    </strong>{' '}
                    粉丝
                  </button>
                </div>
              </div>
            </div>

            <div>
              {isMe ? (
                <Link
                  to="/me"
                  data-testid="btn-user-edit-profile"
                  className="glass-panel inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold text-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.5)]"
                >
                  <Edit3 className="h-3.5 w-3.5 text-primary" />
                  编辑个人资料
                </Link>
              ) : (
                <FollowButton
                  targetUserId={userId}
                  following={Boolean(selfFollowState?.following)}
                  followedBy={Boolean(selfFollowState?.followedBy)}
                  size="md"
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 四类视图弹簧切换 */}
      <div className="flex justify-start overflow-x-auto pb-1">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'posts', label: '帖子', testId: 'user-tab-posts' },
            { value: 'communities', label: '社群', testId: 'user-tab-communities' },
            { value: 'following', label: '关注', testId: 'user-tab-following' },
            { value: 'followers', label: '粉丝', testId: 'user-tab-followers' },
          ]}
        />
      </div>

      {tab === 'posts' && <UserPostsTab userId={userId} />}
      {tab === 'communities' && <UserCommunitiesTab userId={userId} />}
      {tab === 'following' && <UserFollowTab userId={userId} kind="following" />}
      {tab === 'followers' && <UserFollowTab userId={userId} kind="followers" />}
    </div>
  )
}

function UserPostsTab({ userId }: { userId: string }) {
  const posts = useAuthorPosts(userId)
  const items = posts.data?.pages.flatMap((p) => p.items ?? []) ?? []

  if (posts.isError) {
    return (
      <div data-testid="user-posts-error">
        <Empty title="帖子加载失败" description="请稍后重试。" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PostFeed
        posts={items}
        isPending={posts.isPending}
        testId="user-posts"
        emptyTitle="ta 还没有发布过帖子"
        emptyDescription="等 ta 写下第一篇精彩分享吧。"
      />
      {posts.hasNextPage && (
        <div className="text-center">
          <Button
            variant="secondary"
            disabled={posts.isFetchingNextPage}
            onClick={() => void posts.fetchNextPage()}
          >
            {posts.isFetchingNextPage ? '加载中…' : '加载更多帖子'}
          </Button>
        </div>
      )}
    </div>
  )
}

function UserCommunitiesTab({ userId }: { userId: string }) {
  const comms = useUserCommunities(userId)
  const items = comms.data?.pages.flatMap((p) => p.items ?? []) ?? []

  if (comms.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (comms.isError) {
    return (
      <div data-testid="user-communities-error">
        <Empty title="社群列表加载失败" description="请稍后重试。" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <Empty
        testId="user-communities"
        title="ta 还没有加入任何社群"
        icon={<Layers className="h-5 w-5" />}
      />
    )
  }

  return (
    <div data-testid="user-communities" className="grid gap-3 sm:grid-cols-2">
      {items.map((c) => {
        const name = c.name ?? ''
        const chroma = getCommunityChroma(name)
        return (
          <Link
            key={c.id}
            to={`/c/${encodeURIComponent(name)}`}
            data-testid="user-community-item"
            className="block"
          >
            <Card padding="none" className="group overflow-hidden rounded-2xl transition-transform hover:-translate-y-0.5">
              <div className="h-1 w-full" style={{ background: chroma.gradient }} />
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={name} src={c.avatarUrl} size="sm" shape="rounded" />
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-foreground group-hover:text-primary">
                      {name}
                    </p>
                    <p className="tabular-nums text-xs text-muted-foreground">
                      {String(c.memberCount ?? 0)} 位成员
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </div>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}

function UserFollowTab({ userId, kind }: { userId: string; kind: 'following' | 'followers' }) {
  const status = useSession((s) => s.status)
  const isAuth = status === 'authenticated'
  const followingQ = useFollowingList(kind === 'following' ? userId : undefined)
  const followersQ = useFollowersList(kind === 'followers' ? userId : undefined)
  const query = kind === 'following' ? followingQ : followersQ

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [query.data],
  )
  const { data: states } = useFollowStates(
    items.map((u) => u.userId),
    isAuth,
  )

  if (query.isPending) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <div data-testid="user-follow-list-error">
        <Empty title="关系列表加载失败" description="请稍后重试。" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <Empty
        testId="user-follow-list-empty"
        title={kind === 'following' ? 'ta 还没有关注任何人' : '暂时还没有粉丝'}
        icon={kind === 'following' ? <UserCheck className="h-5 w-5" /> : <Users className="h-5 w-5" />}
      />
    )
  }

  return (
    <div data-testid="user-follow-list" className="space-y-2.5">
      {items.map((u) => {
        const uid = u.userId ?? ''
        const nick = u.nickname ?? '已注销用户'
        const st = states?.[uid]
        return (
          <Card key={uid} padding="sm" className="rounded-2xl">
            <div className="flex items-center justify-between gap-3">
              <Link
                to={`/u/${encodeURIComponent(uid)}`}
                data-testid="follow-user-link"
                className="flex min-w-0 items-center gap-3 group"
              >
                <Avatar name={nick} src={u.avatarUrl} size="sm" />
                <span className="truncate font-display text-sm font-bold text-foreground group-hover:text-primary">
                  {nick}
                </span>
              </Link>
              {uid && (
                <FollowButton
                  targetUserId={uid}
                  following={Boolean(st?.following)}
                  followedBy={Boolean(st?.followedBy)}
                />
              )}
            </div>
          </Card>
        )
      })}

      {query.hasNextPage && (
        <div className="pt-2 text-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  )
}
