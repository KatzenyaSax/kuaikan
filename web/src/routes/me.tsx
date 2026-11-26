import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  Bookmark,
  Edit3,
  ExternalLink,
  FileText,
  KeyRound,
  Laptop,
  LogOut,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useSession } from '@/features/auth/session'
import {
  useChangePassword,
  useLogout,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
} from '@/features/auth/session-api'
import { useCommunityList } from '@/features/community/api'
import { useBatchPosts } from '@/features/content/api'
import { useMyFavorites, useToggleFavorite } from '@/features/interaction/api'
import { ApiError } from '@/shared/api/api-error'
import { getCommunityChroma, getUserChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Field, Input } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { Toast } from '@/shared/ui/toast'
import { absoluteDateTime } from '@/shared/lib/time'

const ProfilePanel = lazy(() =>
  import('@/features/ai/profile-panel').then((m) => ({ default: m.ProfilePanel })),
)
const NotesPanel = lazy(() =>
  import('@/features/ai/notes-panel').then((m) => ({ default: m.NotesPanel })),
)

export function MePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const activeTab: 'account' | 'profile' | 'notes' =
    rawTab === 'profile' || rawTab === 'notes' ? rawTab : 'account'
  const noteIdParam = searchParams.get('noteId') ?? undefined
  const user = useSession((s) => s.user)
  const logout = useLogout()
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()

  const sessionsQuery = useSessions(Boolean(user))
  const revokeSession = useRevokeSession()

  const favoritesQuery = useMyFavorites(Boolean(user))
  const unfavorite = useToggleFavorite()
  const { data: communitiesPage } = useCommunityList(null)

  const favItems = useMemo(
    () => favoritesQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [favoritesQuery.data],
  )
  const favPostIds = useMemo(
    () => favItems.map((f) => f.postId).filter((id): id is string => Boolean(id)),
    [favItems],
  )
  const batchPostsQuery = useBatchPosts(favPostIds)
  const batchPosts = batchPostsQuery.data

  const postMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof batchPosts>[number]>()
    for (const p of batchPosts ?? []) {
      if (p.id) m.set(p.id, p)
    }
    return m
  }, [batchPosts])

  const communityNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of communitiesPage?.items ?? []) {
      if (c.id && c.name) m.set(c.id, c.name)
    }
    return m
  }, [communitiesPage])

  // 资料编辑态
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(user?.nickname ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [profileNotice, setProfileNotice] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  // 修改密码态
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)

  if (!user) return null
  const chroma = getUserChroma(user.nickname)

  const openEdit = () => {
    setNickname(user.nickname)
    setAvatarUrl(user.avatarUrl ?? '')
    setProfileError(null)
    setProfileNotice(null)
    setEditing(true)
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    setProfileError(null)
    setProfileNotice(null)
    const cleanNick = nickname.trim()
    if (!cleanNick) {
      setProfileError('昵称不能为空')
      return
    }
    updateProfile.mutate(
      {
        nickname: cleanNick,
        avatarUrl: avatarUrl.trim(),
      },
      {
        onSuccess: () => {
          setEditing(false)
          setProfileNotice('个人资料已更新')
        },
        onError: (err) => {
          setProfileError(err instanceof ApiError ? err.message : '保存失败')
        },
      },
    )
  }

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault()
    setPwdError(null)
    if (newPassword.length < 8) {
      setPwdError('新密码长度至少 8 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致')
      return
    }
    changePassword.mutate(
      { oldPassword, newPassword },
      {
        onSuccess: () => {
          void navigate('/login', { replace: true })
        },
        onError: (err) => {
          setPwdError(err instanceof ApiError ? err.message : '修改密码失败')
        },
      },
    )
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        void navigate('/', { replace: true })
      },
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ====================================================================
          1. 个人身份资料卡片
         ==================================================================== */}
      <Card padding="none" data-testid="profile" className="overflow-hidden rounded-3xl">
        <div className="h-24 w-full" style={{ background: chroma.gradient }} />
        <div className="px-6 pt-4 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="-mt-14 shrink-0 rounded-full bg-[var(--bg-canvas)] p-1.5 shadow-xl ring-1 ring-[var(--border-glass-strong)]">
                <Avatar name={user.nickname} src={user.avatarUrl} size="xl" />
              </div>
              <div className="min-w-0 pb-0.5">
                <h1
                  data-testid="profile-nickname"
                  className="font-display text-2xl font-extrabold tracking-tight text-foreground"
                >
                  {user.nickname}
                </h1>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/u/${encodeURIComponent(user.userId)}`}
                data-testid="link-my-profile"
                className="glass-panel inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-[rgba(var(--accent-rgb),0.5)]"
              >
                <ExternalLink className="h-3.5 w-3.5 text-primary" />
                查看我的主页
              </Link>
              <Button variant="secondary" size="sm" data-testid="btn-edit-profile" onClick={openEdit}>
                <Edit3 className="h-3.5 w-3.5" />
                编辑资料
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="btn-logout"
                disabled={logout.isPending}
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </Button>
            </div>
          </div>

          {profileNotice && (
            <div className="mt-4">
              <Toast
                tone="success"
                message={profileNotice}
                testId="profile-notice"
                onClose={() => setProfileNotice(null)}
              />
            </div>
          )}

          {profileError && (
            <div className="mt-4">
              <Toast
                tone="danger"
                message={profileError}
                testId="toast-error"
                onClose={() => setProfileError(null)}
              />
            </div>
          )}

          {editing && (
            <form
              onSubmit={handleSaveProfile}
              className="mt-5 space-y-4 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="昵称" htmlFor="me-nickname">
                  <Input
                    id="me-nickname"
                    data-testid="field-nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={32}
                    required
                  />
                </Field>
                <Field label="头像链接（可选）" htmlFor="me-avatar">
                  <Input
                    id="me-avatar"
                    data-testid="field-avatar"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                    maxLength={512}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="btn-save-profile"
                  disabled={updateProfile.isPending}
                >
                  {updateProfile.isPending ? '保存中…' : '保存资料'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>

      {/* ====================================================================
          分段切换：账号与收藏 / 我的 AI 档案 / 我的笔记（P9）
         ==================================================================== */}
      <div
        data-testid="me-tabs"
        className="glass-panel inline-flex flex-wrap items-center gap-1 rounded-2xl p-1"
      >
        {(
          [
            { id: 'account', label: '资料与收藏', testId: 'me-tab-account', icon: Bookmark },
            { id: 'profile', label: '我的 AI 档案', testId: 'me-tab-profile', icon: Sparkles },
            { id: 'notes', label: '知识库', testId: 'me-tab-notes', icon: FileText },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={tab.testId}
              onClick={() =>
                setSearchParams(tab.id === 'account' ? {} : { tab: tab.id }, { replace: true })
              }
              className={
                active
                  ? 'inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--color-primary-soft)] px-3.5 py-2 text-xs font-semibold text-primary'
                  : 'inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-secondary-foreground hover:text-foreground'
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'profile' && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-3xl" />}>
          <ProfilePanel />
        </Suspense>
      )}

      {activeTab === 'notes' && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-3xl" />}>
          <NotesPanel initialNoteId={noteIdParam} />
        </Suspense>
      )}

      {activeTab === 'account' && (
        <>
      {/* ====================================================================
          2. 我的收藏（支持已删帖灰色占位 + 一键取消收藏）
         ==================================================================== */}
      <Card padding="md" className="rounded-3xl space-y-4">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-warning" />
          <h2 className="font-display text-base font-bold text-foreground">我的收藏</h2>
          <span className="tabular-nums text-xs text-muted-foreground">
            ({String(favItems.length)})
          </span>
        </div>

        {favoritesQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : favoritesQuery.isError ? (
          <p data-testid="my-favorites-error" className="text-xs text-danger">
            收藏列表加载失败，请刷新重试。
          </p>
        ) : favItems.length === 0 ? (
          <div
            data-testid="my-favorites"
            className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] py-8 text-center text-xs text-muted-foreground"
          >
            你还没有收藏任何帖子，在帖子详情页点亮星标即可收藏到这里。
          </div>
        ) : (
          <div data-testid="my-favorites" className="space-y-2.5">
            {favItems.map((fav) => {
              const pid = fav.postId ?? ''
              const summary = postMap.get(pid)
              const stillLoadingBatch = batchPostsQuery.isPending && !summary

              if (stillLoadingBatch) {
                return <Skeleton key={pid} className="h-16 w-full rounded-2xl" />
              }

              if (!summary) {
                return (
                  <div
                    key={pid}
                    data-testid="favorite-deleted-post"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-4 py-3 opacity-75"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-muted-foreground">
                        该帖子已被作者或管理员删除
                      </p>
                      <p className="tabular-nums text-[11px] text-muted-foreground">
                        收藏于 {absoluteDateTime(fav.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="btn-unfavorite-item"
                      disabled={unfavorite.isPending}
                      onClick={() =>
                        unfavorite.mutate({
                          favorited: true,
                          body: { targetType: 'POST', targetId: pid },
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      取消收藏
                    </Button>
                  </div>
                )
              }

              const commName = summary.communityId
                ? communityNameById.get(summary.communityId)
                : undefined
              const commChroma = getCommunityChroma(commName)
              const href = commName
                ? `/c/${encodeURIComponent(commName)}/p/${encodeURIComponent(pid)}`
                : '#'

              return (
                <div
                  key={pid}
                  data-testid="favorite-post"
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-3 transition-colors hover:border-[rgba(var(--accent-rgb),0.4)]"
                >
                  <Link to={href} className="min-w-0 flex-1 space-y-1 group">
                    <p className="truncate font-display text-sm font-bold text-foreground group-hover:text-primary">
                      {summary.title}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {commName && (
                        <span
                          className="rounded-full px-2 py-0.5 font-semibold text-white"
                          style={{ background: commChroma.gradient }}
                        >
                          #{commName}
                        </span>
                      )}
                      <span className="tabular-nums">收藏于 {absoluteDateTime(fav.createdAt)}</span>
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="btn-unfavorite-item"
                    disabled={unfavorite.isPending}
                    onClick={() =>
                      unfavorite.mutate({
                        favorited: true,
                        body: { targetType: 'POST', targetId: pid },
                      })
                    }
                  >
                    取消收藏
                  </Button>
                </div>
              )
            })}

            {favoritesQuery.hasNextPage && (
              <div className="pt-2 text-center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={favoritesQuery.isFetchingNextPage}
                  onClick={() => void favoritesQuery.fetchNextPage()}
                >
                  {favoritesQuery.isFetchingNextPage ? '加载中…' : '加载更多收藏'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ====================================================================
          3. 活跃登录设备（Session 列表）
         ==================================================================== */}
      <Card padding="md" className="rounded-3xl space-y-4">
        <div className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold text-foreground">登录设备管理</h2>
        </div>

        {sessionsQuery.isPending ? (
          <Skeleton className="h-20 w-full rounded-2xl" />
        ) : (
          <div data-testid="session-list" className="space-y-2.5">
            {(sessionsQuery.data ?? []).map((s) => (
              <div
                key={s.jti}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {s.userAgent || '未知浏览器/设备'}
                    </p>
                    {s.current && <Pill tone="success">当前设备</Pill>}
                  </div>
                  <p className="tabular-nums font-mono text-[11px] text-muted-foreground">
                    IP: {s.ip || '未知'} · 登录于 {absoluteDateTime(s.issuedAt)}
                  </p>
                </div>

                {!s.current && s.jti && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={revokeSession.isPending}
                    onClick={() => s.jti && revokeSession.mutate(s.jti)}
                  >
                    下线该设备
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ====================================================================
          4. 账号安全 · 修改密码（全端下线）
         ==================================================================== */}
      <Card padding="md" className="rounded-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <div>
              <h2 className="font-display text-base font-bold text-foreground">账号安全</h2>
              <p className="text-xs text-muted-foreground">
                修改密码后将自动吊销全部设备的登录凭证，需重新登录
              </p>
            </div>
          </div>

          {!pwdOpen && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="btn-open-change-password"
              onClick={() => {
                setPwdError(null)
                setPwdOpen(true)
              }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              修改密码
            </Button>
          )}
        </div>

        {pwdOpen && (
          <form
            onSubmit={handleChangePassword}
            className="space-y-4 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4"
          >
            <Field label="当前密码" htmlFor="pwd-old">
              <Input
                id="pwd-old"
                type="password"
                data-testid="field-old-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="新密码（至少 8 位）" htmlFor="pwd-new">
                <Input
                  id="pwd-new"
                  type="password"
                  data-testid="field-new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </Field>
              <Field label="确认新密码" htmlFor="pwd-confirm">
                <Input
                  id="pwd-confirm"
                  type="password"
                  data-testid="field-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </Field>
            </div>

            {pwdError && (
              <p
                data-testid="password-error"
                className="rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger"
              >
                {pwdError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPwdOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                data-testid="btn-submit-password"
                disabled={changePassword.isPending}
              >
                {changePassword.isPending ? '提交中…' : '确认修改密码'}
              </Button>
            </div>
          </form>
        )}
      </Card>
        </>
      )}
    </div>
  )
}
