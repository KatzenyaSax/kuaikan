import { useState } from 'react'
import { useNavigate } from 'react-router'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { useLogout, useRevokeSession, useSessions, useUpdateProfile } from '@/features/auth/session-api'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 「我的」页。
 *
 * P1 的定位是**验收载体**而不是产品功能：它是唯一"必须登录才能看"的页面，
 * 三种失效（登出 / 踢下线 / 封禁）都只能在这里被观察到。
 *
 * 同时它并发两个受保护请求（/auth/me 由 store 提供，/auth/sessions 由此页拉取），
 * 这正是"并发 401 只触发一次 refresh"的验证场景。
 */
export function MePage() {
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const logout = useLogout()
  const revoke = useRevokeSession()
  const sessions = useSessions(true)
  const updateProfile = useUpdateProfile()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  if (!user) {
    return <Skeleton className="mx-auto h-6 w-40" />
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle>我的资料</CardTitle>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={startEdit} data-testid="btn-edit-profile">
              编辑
            </Button>
          ) : null}
        </div>

        {editing ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">昵称（2~32 字符）</span>
              <input
                data-testid="field-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">
                头像地址（http/https，留空表示不显示头像）
              </span>
              <input
                data-testid="field-avatar"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          <dl className="grid grid-cols-[64px_1fr] items-center gap-y-2 text-xs" data-testid="profile">
            <dt className="text-muted-foreground">头像</dt>
            <dd>
              <Avatar url={user.avatarUrl} name={user.nickname} size={40} />
            </dd>
            <dt className="text-muted-foreground">昵称</dt>
            <dd data-testid="profile-nickname">{user.nickname}</dd>
            <dt className="text-muted-foreground">邮箱</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">角色</dt>
            <dd>{user.roles}</dd>
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono text-[11px] break-all">{user.userId}</dd>
          </dl>
        )}

        {notice ? (
          <p className="text-[11px] text-success" data-testid="profile-notice">
            {notice}
          </p>
        ) : null}

        <div className="pt-1">
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
      </Card>

      <Card className="space-y-3">
        <CardTitle>登录设备</CardTitle>
        <CardDescription>这些设备持有有效的刷新凭证，可以逐个踢掉。</CardDescription>

        {sessions.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : sessions.isError ? (
          <CardDescription className="text-danger">{authErrorMessage(sessions.error)}</CardDescription>
        ) : (
          <ul className="space-y-2" data-testid="session-list">
            {(sessions.data ?? []).map((s) => (
              <li
                key={s.jti}
                className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 text-[11px]"
              >
                <div className="min-w-0">
                  <div className="truncate">{s.userAgent ?? '未知设备'}</div>
                  <div className="text-muted-foreground">
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
              <li className="text-[11px] text-muted-foreground">没有其他有效会话</li>
            ) : null}
          </ul>
        )}
      </Card>

      {error ? (
        <p className="text-[11px] text-danger" data-testid="toast-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
