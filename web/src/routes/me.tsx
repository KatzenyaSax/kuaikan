import { useState } from 'react'
import { useNavigate } from 'react-router'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { useLogout, useRevokeSession, useSessions, useUpdateProfile } from '@/features/auth/session-api'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/field'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'

/**
 * 「我的」。
 *
 * P1 的定位是**验收载体**：它是唯一"必须登录才能看"的页面，三种失效
 * （登出 / 踢下线 / 封禁）都只能在这里被观察到。
 *
 * 同时它并发两个受保护请求（/auth/me 由 store 提供，/auth/sessions 由此页拉取），
 * 这正是"并发 401 只触发一次 refresh"的验证场景。
 *
 * 排版：两组内容用 hairline 分开，**不用卡片**。
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

  return (
    <div className="mx-auto max-w-[40rem] px-6 pb-24 pt-12">
      <h1 className="m-0 mb-8 text-title font-[640]">我的</h1>

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
