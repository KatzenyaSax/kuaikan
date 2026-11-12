import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

export type CommunityPage = OkData<'list'>
export type CommunitySummary = NonNullable<CommunityPage['items']>[number]
export type CommunityDetail = OkData<'detail'>
export type CreateCommunityBody = RequestBody<'create'>

const BASE = '/api/community/communities'

/**
 * 社群列表。游客可读。
 *
 * 游标是**不透明字符串**：前端只回传，不解析、不拼。
 * 服务端会把排序标记编进去，跨排序复用会返回 40010。
 */
export function useCommunityList(cursor: string | null) {
  return useQuery({
    queryKey: ['community', 'list', cursor],
    queryFn: () => api.get<CommunityPage>(`${BASE}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  })
}

/**
 * 社群详情。游客可读，响应里没有任何按查看者变化的字段。
 *
 * 路径里用名称（不是 id）：社群名本身就是标识，服务端会做规范化，
 * 所以 /c/FRONTEND 与 /c/frontend 命中同一个社群。
 */
export function useCommunityDetail(name: string | undefined) {
  return useQuery({
    queryKey: ['community', 'detail', name],
    queryFn: () => api.get<CommunityDetail>(`${BASE}/${encodeURIComponent(name ?? '')}`),
    enabled: Boolean(name),
  })
}

export function useCreateCommunity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCommunityBody) => api.post<CommunityDetail>(BASE, body),
    onSuccess: () => {
      // 新社群会出现在列表最前面，让首页立刻能看见
      void queryClient.invalidateQueries({ queryKey: ['community', 'list'] })
    },
  })
}
