import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'
import { narrowProfile, useSession } from '@/features/auth/session'
import type { LogoutReason, SessionItem, UserProfile } from '@/features/auth/session'

const AUTH_BASE = '/api/user/auth'

export type SessionList = OkData<'sessions'>
export type { UserProfile }

export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<SessionList>(`${AUTH_BASE}/sessions`),
    enabled,
    staleTime: 10_000,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jti: SessionItem['jti']) => api.del<unknown>(`${AUTH_BASE}/sessions/${jti}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  })
}

export type UpdateProfileBody = RequestBody<'updateProfile'>

/**
 * 修改自己的资料。
 *
 * 成功后两件事都要做：
 *   1. 用**服务端返回的** profile 回写 store（不要本地拼，服务端会 trim、
 *      会把空字符串转成 null）
 *   2. 让 sessions 等列表刷新（昵称会变）
 */
export function useUpdateProfile() {
  const setUser = useSession((s) => s.setUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateProfileBody) =>
      api.patch<OkData<'updateProfile'>>(`${AUTH_BASE}/me`, body),
    onSuccess: (wire) => {
      setUser(narrowProfile(wire))
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })
    },
  })
}

export function useLogout() {
  const logout = useSession((s) => s.logout)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.clear(),
  })
}

export type ChangePasswordBody = RequestBody<'changePassword'>

/**
 * 修改密码（P5.5.3）。成功后服务端已经把该用户**全部** refresh 吊销、
 * 全部 access 白名单键删除，并下发清除 kuaikan_refresh cookie 的 Set-Cookie。
 *
 * **本 hook 刻意不在 onSuccess 里清会话**：收尾（清本地会话 + 跳登录页）
 * 由调用方决定，因为"为什么会在登录页"必须能跨过一次路由切换。
 * `useSession.clear()` 会把 status 改成 'anonymous'，`RequireAuth` 立刻渲染
 * `<Navigate to="/login?returnTo=%2Fme" replace />`——任何塞进
 * `location.state` 的提示都会被那次 replace 覆盖，所以原因走 store 的
 * `logoutReason`（见 {@link useClearLocalSession}）。
 *
 * 所以收尾由调用方做：`useClearLocalSession('password_changed')` 把原因写进
 * store（登录页从那里读提示），随后 `navigate('/login', { replace: true })`。
 * 顺序已经不重要——notice 不再走 `location.state`，不会被 RequireAuth 覆盖。
 *
 * 任何情况下都**不再发 `/auth/logout`**：那会带着一枚已被吊销的 access
 * 再打一次请求，换回 401 和一次无意义的续期尝试（p55-social.md §6.2 第 4 条）。
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordBody) =>
      api.post<OkData<'changePassword'>>(`${AUTH_BASE}/password`, body),
  })
}

/**
 * 改密成功后的本地收尾。
 *
 * 提示文案**不靠 router `location.state`**：`clear()` 把 status 置成 anonymous 后，
 * `<RequireAuth>` 会在同一帧渲染 `<Navigate to="/login?returnTo=%2Fme" replace />`，
 * 那次重定向会把 `location.state` 抹掉（实测 history 里先有 `{notice}`，
 * 紧接着被 `{usr:null}` 覆盖）。所以改密原因写进 Zustand 的 `logoutReason`，
 * 登录页从 store 里读——state 更新不会互相覆盖。
 *
 * `queryClient.clear()`：收藏、会话列表这些属于旧身份的缓存
 * 不能留给下一个登录的人。
 */
export function useClearLocalSession() {
  const queryClient = useQueryClient()
  return useCallback(
    (reason?: LogoutReason) => {
      useSession.getState().clear(reason)
      queryClient.clear()
    },
    [queryClient],
  )
}
