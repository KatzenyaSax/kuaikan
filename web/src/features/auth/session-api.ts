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
