import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'
import { useSession } from '@/features/auth/session'
import type { SessionItem } from '@/features/auth/session'

const AUTH_BASE = '/api/user/auth'

export type SessionList = OkData<'sessions'>

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

export function useLogout() {
  const logout = useSession((s) => s.logout)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.clear(),
  })
}
