import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import {
  useChangePassword,
  useClearLocalSession,
  useLogout,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
} from '@/features/auth/session-api'
import { useCommunityList } from '@/features/community/api'
import { useBatchPosts, useUserSummaries } from '@/features/content/api'
import { FeedLoadMore } from '@/features/content/post-feed'
import { useMyFavorites, useToggleFavorite } from '@/features/interaction/api'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Input } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'
import { relativeTime } from '@/shared/lib/time'

/**
 * 「我的」。
 *
 * P1 的定位是**验收载体**：它是唯一「必须登录才能看」的页面，三种失效
 * （登出 / 踢下线 / 封禁）都只能在这里被观察到。P5.5.3 加了修改密码与我的收藏，
 * 但**原有 data-testid 一个都没改、也没被挪进 Tab**：
 * `/me` 采用「页内 hairline 分区」而不是 Tab 切换，正是为了让
 * `profile` / `profile-nickname` / `btn-edit-profile` / `btn-logout` / `session-list`
 * 继续在首屏立即可见（p55-social.md §6.3，P1 回归零破坏）。
 *
 * 排版：四个分区用 hairline 分开，**不用卡片**。
 */
export function MePage() {
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const logout = useLogout()
  const revoke = useRevokeSession()
  const sessions = useSessions(true)
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()
  const clearLocalSession = useClearLocalSession()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  if (!user) {
    return <Skeleton className="mx-auto mt-16 h-6 w-40" />
  }

  const startEdit = () => {
    setNickname(user.nickname)
    setAvatarUrl(user.avatarUrl ?? '')
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  const save = () => {
    setError(null)
    setNotice(null)
    updateProfile.mutate(
      // 头像用空字符串表示"清空"（服务端约定，见 UpdateProfileRequest）
      { nickname, avatarUrl },
      {
        onSuccess: () => {
          setEditing(false)
          setNotice('资料已更新')
          toast('资料已更新')
        },
        onError: (err) => setError(authErrorMessage(err)),
      },
    )
  }

  const onLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/', { replace: true }),
      onError: (err) => setError(authErrorMessage(err)),
    })
  }

  const resetPasswordForm = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
  }

  /**
   * 改密提交。
   *
   * 前端只拦两件事：**长度**与**两次输入是否一致**。其余（原密码错、新旧相同）
   * 交给服务端判定 —— 那两条必须由 40207 / 40208 回答，前端抢先拦掉等于
   * 让服务端的权威判定永远不被走到。
   *
   * 成功之后服务端已经把全部 refresh / access 吊销。本地收尾的**顺序不能换**：
   * 先 navigate 离开 `/me`，再 `clearLocalSession()`。
   *
   * 反过来的话，`clear()` 会把 status 置为 anonymous，`<RequireAuth>` 立刻
   * 渲染 `<Navigate to="/login?returnTo=%2Fme" replace />`，抢在我们的
   * navigate 之前把页面切走，`location.state.notice` 就被吃掉了——
   * 用户只看到一个没有任何说明的登录页。
   *
   * **仍不再发 /auth/logout**（那会带着一枚死 access 换回 401）。
   */
  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (oldPassword.length === 0) {
      setPasswordError('请输入原密码')
      return
    }
    if (newPassword.length < 8 || newPassword.length > 72) {
      setPasswordError('新密码长度需在 8~72 之间')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    changePassword.mutate(
      { oldPassword, newPassword },
      {
        onSuccess: () => {
          // 先离开 <RequireAuth>，再清会话（顺序见上方注释）
          navigate('/login', {
            replace: true,
            state: { notice: '密码已修改，请使用新密码重新登录' },
          })
          clearLocalSession()
        },
        onError: (err) => setPasswordError(authErrorMessage(err)),
      },
    )
  }

  return (
    <div className="mx-auto max-w-[40rem] px-6 pb-24 pt-12">
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-title font-[640]">我的</h1>
        <Link
          to={`/u/${encodeURIComponent(user.userId)}`}
          className="shrink-0 text-aux text-muted-foreground no-underline transition-colors duration-[150ms] hover:text-foreground hover:underline"
          data-testid="link-my-profile"
        >
          查看我的主页 →
        </Link>
      </div>

      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="m-0 text-sub font-semibold">资料</h2>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={startEdit} data-testid="btn-edit-profile">
              编辑
            </Button>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-caption text-faint">昵称（2~32 字符）</span>
              <Input
                data-testid="field-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption text-faint">
                头像地址（http/https，留空表示不显示头像）
              </span>
              <Input
                data-testid="field-avatar"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={updateProfile.isPending} data-testid="btn-save-profile">
                {updateProfile.isPending ? '保存中…' : '保存'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <dl className="m-0 grid grid-cols-[64px_1fr] items-center gap-y-4 text-body" data-testid="profile">
            <dt className="text-aux text-faint">头像</dt>
            <dd className="m-0">
              <Avatar url={user.avatarUrl} name={user.nickname} size={40} />
            </dd>
            <dt className="text-aux text-faint">昵称</dt>
            <dd className="m-0" data-testid="profile-nickname">
              {user.nickname}
            </dd>
            <dt className="text-aux text-faint">邮箱</dt>
            <dd className="m-0 text-muted-foreground">{user.email}</dd>
            <dt className="text-aux text-faint">角色</dt>
            <dd className="m-0 text-muted-foreground">{user.roles}</dd>
            <dt className="text-aux text-faint">ID</dt>
            <dd className="m-0 break-all font-mono text-caption text-faint">{user.userId}</dd>
          </dl>
        )}

        {notice ? (
          <p className="mt-3 text-aux text-success" data-testid="profile-notice">
            {notice}
          </p>
        ) : null}

        <div className="mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            disabled={logout.isPending}
            data-testid="btn-logout"
          >
            {logout.isPending ? '退出中…' : '退出登录'}
          </Button>
        </div>
      </section>

      {/* 修改密码：默认收起，点开才出现输入框。收起态只占一行，不干扰首屏 */}
      <section className="mt-12 border-t border-border pt-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="m-0 text-sub font-semibold">修改密码</h2>
            <p className="m-0 mt-1.5 text-aux text-muted-foreground">
              修改成功后所有设备都会退出登录，需要用新密码重新登录。
            </p>
          </div>
          {!changingPassword ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setPasswordError(null)
                setChangingPassword(true)
              }}
              data-testid="btn-open-change-password"
            >
              修改
            </Button>
          ) : null}
        </div>

        {changingPassword ? (
          <form className="mt-5 space-y-4" onSubmit={submitPassword} noValidate>
            <label className="block">
              <span className="mb-1.5 block text-caption text-faint">原密码</span>
              <Input
                data-testid="field-old-password"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption text-faint">新密码（8~72 字符）</span>
              <Input
                data-testid="field-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption text-faint">确认新密码</span>
              <Input
                data-testid="field-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                type="submit"
                disabled={changePassword.isPending}
                data-testid="btn-submit-password"
              >
                {changePassword.isPending ? '提交中…' : '确认修改'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setChangingPassword(false)
                  resetPasswordForm()
                }}
              >
                取消
              </Button>
            </div>
            {passwordError ? (
              <p className="m-0 text-aux text-danger" data-testid="password-error">
                {passwordError}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <FavoritesSection />

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="m-0 mb-1.5 text-sub font-semibold">登录设备</h2>
        <p className="m-0 mb-5 text-aux text-muted-foreground">
          这些设备持有有效的刷新凭证，可以逐个踢掉。
        </p>

        {sessions.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sessions.isError ? (
          <p className="text-aux text-danger">{authErrorMessage(sessions.error)}</p>
        ) : (
          <ul className="m-0 list-none p-0" data-testid="session-list">
            {(sessions.data ?? []).map((s) => (
              <li
                key={s.jti}
                className="flex items-center justify-between gap-4 py-3.5 text-aux [&+&]:border-t [&+&]:border-border"
              >
                <div className="min-w-0">
                  <div className="truncate text-foreground">{s.userAgent ?? '未知设备'}</div>
                  <div className="mt-0.5 text-caption text-faint">
                    {s.ip ?? '-'} · {s.issuedAt ?? '-'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke.mutate(s.jti ?? '')}
                  disabled={revoke.isPending}
                >
                  踢掉
                </Button>
              </li>
            ))}
            {(sessions.data ?? []).length === 0 ? (
              <li className="py-3 text-aux text-faint">没有其他有效会话</li>
            ) : null}
          </ul>
        )}
      </section>

      {error ? (
        <p className="mt-6 text-aux text-danger" data-testid="toast-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * 我的收藏（P5.5.3）。
 *
 * 四个请求拼出这一屏，**没有任何一个跨服务调用落在后端**（ADR 0005）：
 *   1. `GET /interaction/favorites` —— 我收藏了哪些帖子（只有 postId + createdAt）
 *   2. `POST /content/posts/batch`  —— 这些帖子还在不在、标题是什么
 *   3. `GET /user/users?ids=`       —— 作者昵称
 *   4. `GET /community/communities` —— 社群名（帖子 DTO 里只有 communityId）
 *
 * 「已删帖」是**推导出来的**：batch 只返回 `status = 1` 的帖子，
 * 所以「batch 成功但 Map 里没有这个 postId」就等于「这篇被删了」。
 * 不能靠"标题为空"之类的蛛丝马迹判断——那在正常帖子上也会误伤。
 * 已删帖仍然保留「取消收藏」，否则用户没法把这行清掉。
 */
function FavoritesSection() {
  const favorites = useMyFavorites(true)
  const toggleFavorite = useToggleFavorite()

  const items = (favorites.data?.pages ?? []).flatMap((p) => p.items ?? [])
  const postIds = items.map((i) => i.postId ?? '').filter((id) => id.length > 0)

  // 一次把已加载的全部收藏帖补齐。超过 50 个由 useBatchPosts 自己分批
  const batch = useBatchPosts(postIds)
  const postById = new Map((batch.data ?? []).map((p) => [p.id ?? '', p]))

  const authorIds = [...postById.values()].map((p) => p.authorId)
  const users = useUserSummaries(authorIds)
  const authorNameById = new Map((users.data ?? []).map((u) => [u.userId ?? '', u.nickname ?? '']))

  const communities = useCommunityList(null)
  const communityNameById = new Map(
    (communities.data?.items ?? []).map((c) => [c.id ?? '', c.name ?? '']),
  )

  const unfavorite = (postId: string) => {
    toggleFavorite.mutate({ favorited: true, body: { targetType: 'post', targetId: postId } })
  }

  return (
    <section className="mt-12 border-t border-border pt-8" data-testid="my-favorites">
      <h2 className="m-0 mb-1.5 text-sub font-semibold">我的收藏</h2>
      <p className="m-0 mb-5 text-aux text-muted-foreground">
        收藏是私密的，只有你自己能看到。帖子被删除后会显示为占位行。
      </p>

      {favorites.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : favorites.isError ? (
        <p className="m-0 text-aux text-danger" data-testid="my-favorites-error">
          {authErrorMessage(favorites.error)}
        </p>
      ) : items.length === 0 ? (
        <Empty title="还没有收藏任何帖子" testId="my-favorites-empty" />
      ) : (
        <>
          <ul className="m-0 list-none p-0">
            {items.map((item) => {
              const postId = item.postId ?? ''
              const post = postById.get(postId)
              const communityName = communityNameById.get(post?.communityId ?? '')
              // batch 还没回来时先不给结论：否则每一行都会先闪一下"已删除"
              const deleted = batch.isSuccess && !post

              return (
                <li
                  key={postId}
                  className="flex items-start justify-between gap-4 py-4 [&+&]:border-t [&+&]:border-border"
                >
                  <div className="min-w-0">
                    {deleted ? (
                      <p
                        className="m-0 text-body text-faint line-through"
                        data-testid="favorite-deleted-post"
                      >
                        该帖子已被删除
                      </p>
                    ) : post ? (
                      communityName ? (
                        <Link
                          to={`/c/${encodeURIComponent(communityName)}/p/${postId}`}
                          className="group block no-underline"
                          data-testid="favorite-post"
                        >
                          <p className="m-0 line-clamp-2 text-body font-medium leading-[1.5] text-foreground group-hover:text-primary">
                            {post.title ?? '（无标题）'}
                          </p>
                        </Link>
                      ) : (
                        // 社群不在列表首页时不给假链接：拼一个 /c//p/xxx 只会是 404
                        <p
                          className="m-0 line-clamp-2 text-body font-medium leading-[1.5] text-foreground"
                          data-testid="favorite-post"
                        >
                          {post.title ?? '（无标题）'}
                        </p>
                      )
                    ) : (
                      <Skeleton className="h-5 w-56" />
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-caption text-faint">
                      {post && communityName ? <Pill>{communityName}</Pill> : null}
                      {post?.authorId && !users.isPending ? (
                        <span>{authorNameById.get(post.authorId) ?? '已注销用户'}</span>
                      ) : null}
                      <span>收藏于 {relativeTime(item.createdAt)}</span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => unfavorite(postId)}
                    disabled={toggleFavorite.isPending}
                    data-testid="btn-unfavorite-item"
                  >
                    取消收藏
                  </Button>
                </li>
              )
            })}
          </ul>

          <FeedLoadMore
            hasNextPage={favorites.hasNextPage}
            isFetchingNextPage={favorites.isFetchingNextPage}
            onLoadMore={() => void favorites.fetchNextPage()}
            testId="btn-load-more-favorites"
          />
        </>
      )}
    </section>
  )
}
