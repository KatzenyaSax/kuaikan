import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'
import { narrowProfile, useSession } from '@/features/auth/session'
import type { SessionItem, UserProfile } from '@/features/auth/session'

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
 * **本 hook 刻意不在 onSuccess 里清会话**：`/me` 包在 `RequireAuth` 里，
 * 而 `useSession.clear()` 会把 status 改成 'anonymous'，`RequireAuth`
 * 立刻渲染 `<Navigate to="/login?returnTo=%2Fme" replace />`——
 * 它会抢在调用方的 `navigate('/login', { state: { notice } })` 之前把页面切走，
 * 于是改密提示永远看不到。
 *
 * 所以收尾拆成两步，由调用方定顺序：
 *   1. 先 `navigate('/login', { replace: true, state: { notice } })`（离开 RequireAuth）
 *   2. 再 `useClearLocalSession()`（清本地会话 + 缓存）
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
 * <b>必须在 navigate 之后调</b>（理由见 {@link useChangePassword}）：
 * 先离开 `/me`，再让 status 变成 anonymous，否则 `RequireAuth` 会抢先重定向，
 * 把 `location.state.notice` 吃掉。
 *
 * `queryClient.clear()`：收藏、会话列表这些属于旧身份的缓存
 * 不能留给下一个登录的人。
 */
export function useClearLocalSession() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    useSession.getState().clear()
    queryClient.clear()
  }, [queryClient])
}
