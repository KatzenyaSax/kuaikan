import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCommunityList, useUserCommunities } from '@/features/community/api'
import { useAuthorPosts } from '@/features/content/api'
import { FeedLoadMore, PostFeedRow } from '@/features/content/post-feed'
import { useSession } from '@/features/auth/session'
import { authErrorMessage } from '@/features/auth/auth-error'
import { FollowButton } from '@/features/social/follow-button'
import {
  useFollowersList,
  useFollowingList,
  useFollowStates,
  useUserProfile,
} from '@/features/social/api'
import { ApiError } from '@/shared/api/api-error'
import { Avatar } from '@/shared/ui/avatar'
import { buttonClass } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

/**
 * 用户主页（P5.5.2）。
 *
 * ## 游客全量可读
 *
 * 四个 Tab 全部走游客可读端点（profile / posts?authorId / users/{id}/communities /
 * following / followers），后端不做任何依赖 viewer 的聚合（ADR 0005）。
 * 「我关注 ta 吗」由 `FollowButton` 自己并行查（单个用户，一次请求，不是 N+1）。
 *
 * ## 读路径零跨服务调用
 *
 * - 帖子里只有 `communityId`（ADR 0009），社群名从 `useCommunityList` 的缓存映射；
 * - 作者昵称头像直接来自各列表接口（帖子列表不拼作者摘要——ta 的帖子里作者就是 ta 自己）。
 *
 * ## 计数可点
 *
 * 「关注 N / 粉丝 M」不是纯展示：点一下就切到对应的 Tab。
 * 这是页面上最自然的"我还能看什么"的入口，比在 Tab 栏里再强调一遍更省。
 */
type TabKey = 'posts' | 'communities' | 'following' | 'followers'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'posts', label: '帖子' },
  { key: 'communities', label: '社群' },
  { key: 'following', label: '关注' },
  { key: 'followers', label: '粉丝' },
]

/** 40209 = 用户不存在；404 是它映射到的 HTTP 状态（contract/error-codes.json） */
function isUserMissing(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 40209 || err.status === 404)
}

export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  // 薄壳只负责「按 userId 重挂载」：从 /u/A 的关注列表点进 /u/B 时，
  // 路由组件会被复用（同一路由模式），tab 状态会粘在上一个人的 Tab 上。
  // key 换掉就重新挂载，tab 自然回到 'posts'——比用 useEffect 手动重置干净，
  // 也不会出现"先渲染旧 Tab 再跳"的一帧。
  return <UserProfileBody key={userId ?? ''} userId={userId} />
}

function UserProfileBody({ userId }: { userId: string | undefined }) {
  const profile = useUserProfile(userId)
  const me = useSession((s) => s.user)
  const [tab, setTab] = useState<TabKey>('posts')

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-12" data-testid="user-profile-page">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1">
            <Skeleton className="mb-2 h-6 w-40" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
        <Skeleton className="mt-10 h-40 w-full" />
      </div>
    )
  }

  // 用户不存在 / 已注销：不区分两者（与帖子详情的纪律一致，见 p2 §"对外一律不存在"）
  if (profile.isError) {
    return (
      <div className="mx-auto max-w-[40rem] px-6 py-16 md:px-11" data-testid="user-profile-page">
        {isUserMissing(profile.error) ? (
          <Empty
            title="用户不存在或已注销"
            description="这个主页可能已经被删除，或者链接里的 id 有误。"
            testId="user-profile-missing"
            action={
              <Link to="/" className="text-aux text-primary hover:underline">
                回到首页
              </Link>
            }
          />
        ) : (
          <p className="m-0 text-body text-danger" data-testid="user-profile-error">
            {authErrorMessage(profile.error)}
          </p>
        )}
      </div>
    )
  }

  const user = profile.data
  const isSelf = Boolean(me && user.userId && me.userId === user.userId)
  const followingCount = user.followingCount ?? 0
  const followerCount = user.followerCount ?? 0

  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-12" data-testid="user-profile-page">
      {/* 头部：头像 / 昵称 / 计数 / 动作。分区只有留白，没有卡片 */}
      <div className="flex items-start gap-4">
        <Avatar url={user.avatarUrl ?? null} name={user.nickname ?? ''} size={56} />
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 truncate text-title font-[640] leading-[1.32]"
            data-testid="user-profile-nickname"
          >
            {user.nickname ?? '已注销用户'}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-aux text-muted-foreground">
            <button
              type="button"
              onClick={() => setTab('following')}
              className="hover:text-foreground"
              data-testid="user-profile-following-count"
            >
              <span className="font-semibold tabular-nums text-foreground">{followingCount}</span>{' '}
              关注
            </button>
            <span className="text-faint">·</span>
            <button
              type="button"
              onClick={() => setTab('followers')}
              className="hover:text-foreground"
              data-testid="user-profile-follower-count"
            >
              <span className="font-semibold tabular-nums text-foreground">{followerCount}</span>{' '}
              粉丝
            </button>
          </div>
        </div>
        <div className="shrink-0">
          {isSelf ? (
            <Link
              to="/me"
              className={buttonClass({ variant: 'outline', size: 'sm' })}
              data-testid="btn-user-edit-profile"
            >
              编辑资料
            </Link>
          ) : (
            <FollowButton userId={user.userId} testId="btn-follow-profile" />
          )}
        </div>
      </div>

      {/* Tab 栏：hairline 收口，当前项靠字重 + 底部短横线，不用色块 */}
      <div className="mt-9 flex gap-6 border-b border-border" role="tablist" aria-label="主页内容">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'relative -mb-px h-10 text-aux transition-colors duration-[150ms]',
              tab === t.key
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid={`user-tab-${t.key}`}
          >
            {t.label}
            {tab === t.key ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-foreground" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="pt-2" role="tabpanel">
        {tab === 'posts' ? <PostsTab userId={user.userId ?? ''} /> : null}
        {tab === 'communities' ? <CommunitiesTab userId={user.userId ?? ''} /> : null}
        {tab === 'following' ? <FollowingTab userId={user.userId ?? ''} /> : null}
        {tab === 'followers' ? <FollowersTab userId={user.userId ?? ''} /> : null}
      </div>
    </div>
  )
}

/**
 * ta 发的帖子。
 *
 * 社群名从社群列表（首页同一份缓存）映射 —— 帖子 DTO 里只有 `communityId`。
 * 社群很多时这里只看得到第一页社群的名字，映射不到的行会退化成不可点的纯文本，
 * 不编造一个假名字。
 */
function PostsTab({ userId }: { userId: string }) {
  const query = useAuthorPosts(userId)
  const communities = useCommunityList(null)
  const nameById = new Map(
    (communities.data?.items ?? []).map((c) => [c.id ?? '', c.name ?? '']),
  )
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])

  if (query.isPending) {
    return <FeedSkeleton />
  }
  if (query.isError) {
    return (
      <p className="py-8 text-aux text-danger" data-testid="user-posts-error">
        {authErrorMessage(query.error)}
      </p>
    )
  }
  if (items.length === 0) {
    return <Empty title="ta 还没有发过帖子" testId="user-posts-empty" />
  }

  return (
    <div data-testid="user-posts">
      <ul className="m-0 list-none p-0">
        {items.map((p) => (
          <li key={p.id} className="py-4 [&+&]:border-t [&+&]:border-border">
            <PostFeedRow post={p} communityName={nameById.get(p.communityId ?? '')} />
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

/** ta 加入的社群。服务端已过滤 status=1 的成员关系与社群 */
function CommunitiesTab({ userId }: { userId: string }) {
  const query = useUserCommunities(userId)
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])

  if (query.isPending) {
    return <FeedSkeleton />
  }
  if (query.isError) {
    return (
      <p className="py-8 text-aux text-danger" data-testid="user-communities-error">
        {authErrorMessage(query.error)}
      </p>
    )
  }
  if (items.length === 0) {
    return <Empty title="ta 还没有加入任何社群" testId="user-communities-empty" />
  }

  return (
    <div data-testid="user-communities">
      <ul className="m-0 list-none p-0">
        {items.map((c) => (
          <li key={c.id} className="py-3.5 [&+&]:border-t [&+&]:border-border">
            <Link
              to={`/c/${encodeURIComponent(c.name ?? '')}`}
              className="flex items-center gap-3 rounded-md py-1 hover:opacity-80"
              data-testid="user-community-item"
            >
              <Avatar url={null} name={c.name ?? ''} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{c.name}</span>
                {c.description ? (
                  <span className="mt-0.5 block truncate text-caption text-faint">
                    {c.description}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-caption text-faint">{c.memberCount ?? 0} 成员</span>
            </Link>
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

/**
 * 关注 / 粉丝列表。
 *
 * 两个 hook 只是路径不同、返回形状相同，所以共用一个展示组件；
 * **调用必须分开写**（hooks 不能写在条件里）。
 */
function FollowingTab({ userId }: { userId: string }) {
  return <FollowList query={useFollowingList(userId)} emptyText="ta 还没有关注任何人" />
}

function FollowersTab({ userId }: { userId: string }) {
  return <FollowList query={useFollowersList(userId)} emptyText="还没有人关注 ta" />
}

function FollowList({
  query,
  emptyText,
}: {
  query: ReturnType<typeof useFollowingList>
  emptyText: string
}) {
  const authed = useSession((s) => s.status) === 'authenticated'
  const items = (query.data?.pages ?? []).flatMap((p) => p.items ?? [])
  // 当前已加载的**整页**用户一次查完关系：列表里 N 个按钮 = 1 次请求。
  // 严禁逐个 FollowButton 单查（那是 N+1，也是 p55-social.md §7 明确否掉的写法）。
  const pageUserIds = items
    .map((u) => u.userId)
    .filter((id): id is string => Boolean(id))
  const states = useFollowStates(pageUserIds, authed)

  if (query.isPending) {
    return <FeedSkeleton />
  }
  if (query.isError) {
    return (
      <p className="py-8 text-aux text-danger" data-testid="user-follow-list-error">
        {authErrorMessage(query.error)}
      </p>
    )
  }
  if (items.length === 0) {
    return <Empty title={emptyText} testId="user-follow-list-empty" />
  }

  return (
    <div data-testid="user-follow-list">
      <ul className="m-0 list-none p-0">
        {items.map((u) => {
          const state = u.userId ? states.data?.[u.userId] : undefined
          // 已登录但批量状态还没回来时不渲染按钮：
          // 这时候传 undefined 会让 FollowButton 内部**逐个单查**（列表 N+1）。
          // 给个占位块保住布局，比闪烁一个错的状态好。
          const button = state ? (
            <FollowButton userId={u.userId ?? undefined} testId="btn-follow-list" state={state} />
          ) : authed ? (
            <span className="h-8 w-[52px] shrink-0" aria-hidden />
          ) : (
            // 游客：已知必然未登录，直接给默认状态（未关注）——点击会去登录，不发 states
            <FollowButton
              userId={u.userId ?? undefined}
              testId="btn-follow-list"
              state={{ following: false, followedBy: false }}
            />
          )
          return (
            <li
              key={u.userId}
              className="flex items-center gap-3 py-3.5 [&+&]:border-t [&+&]:border-border"
            >
              <Link
                to={`/u/${encodeURIComponent(u.userId ?? '')}`}
                className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
                data-testid="follow-user-link"
              >
                <Avatar url={u.avatarUrl ?? null} name={u.nickname ?? ''} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium">
                    {u.nickname ?? '已注销用户'}
                  </span>
                  <span className="block text-caption text-faint">{relativeTime(u.followedAt)}</span>
                </span>
              </Link>
              {/* 状态必须**显式传入**（游客传默认值）：不传会退化成 N+1 个单查 */}
              {button}
            </li>
          )
        })}
      </ul>
      <FeedLoadMore
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
      />
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 pt-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}
