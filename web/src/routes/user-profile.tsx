import { Link, useParams } from 'react-router'
import { useUserSummaries } from '@/features/content/api'
import { Avatar } from '@/shared/ui/avatar'

/**
 * 用户主页（**占位页**）。
 *
 * 关注体系还没做，所以这里不摆假数据、不装作有内容：
 * 只显示昵称与头像，然后如实说明还没开放。
 *
 * 为什么现在就要有这个路由：评论区里的 `@某人` 需要**点得动**。
 * 一个蓝色的、点了没反应的昵称比普通文字更让人困惑。
 *
 * 路由用 `/u/:userId`：`/me` 是"我自己的资料编辑"，两者语义不同，不合并。
 */
export function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const summaries = useUserSummaries([userId])
  const user = summaries.data?.find((u) => u.userId === userId)

  return (
    <div className="mx-auto max-w-[40rem] px-6 py-16 md:px-11" data-testid="user-profile-page">
      {summaries.isPending ? null : user ? (
        <div className="flex items-center gap-3.5">
          <Avatar url={user.avatarUrl ?? null} name={user.nickname ?? ''} size={56} />
          <div>
            <p className="m-0 text-sub font-semibold text-foreground" data-testid="user-profile-nickname">
              {user.nickname}
            </p>
            <p className="m-0 mt-1 text-aux text-muted-foreground">用户主页</p>
          </div>
        </div>
      ) : (
        <p className="m-0 text-body text-muted-foreground" data-testid="user-profile-missing">
          用户不存在或已注销
        </p>
      )}

      <div className="mt-10 rounded-lg bg-surface px-6 py-10 text-center">
        <p className="m-0 mb-2 text-body font-medium text-foreground">个人主页还没有开放</p>
        <p className="m-0 text-aux leading-[1.7] text-muted-foreground">
          这里以后会放 ta 发过的帖子、加入的社群和关注关系。
          <br />
          现在关注体系还没做，所以先不摆假内容。
        </p>
      </div>

      <p className="mt-8 text-aux">
        <Link to="/" className="text-primary hover:underline">
          回到首页
        </Link>
      </p>
    </div>
  )
}
