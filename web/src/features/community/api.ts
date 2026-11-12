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

/** 我加入的社群。需要登录；左栏的"我加入的社群"与加入按钮的初始状态都靠它 */
export function useMyCommunities(enabled = true) {
  return useQuery({
    queryKey: ['community', 'mine'],
    queryFn: () => api.get<CommunityPage>(`/api/community/mine?limit=50`),
    enabled,
  })
}

/**
 * 加入 / 退出。
 *
 * 两者都是**幂等**的：重复点击不会让 member_count 多算或少算。
 * 成功后要失效三处：
 *   - mine：左栏列表与按钮状态
 *   - detail：member_count 变了
 *   - list：首页卡片上的成员数
 */
export function useMembership() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['community', 'mine'] })
    void queryClient.invalidateQueries({ queryKey: ['community', 'detail'] })
    void queryClient.invalidateQueries({ queryKey: ['community', 'list'] })
  }
  const join = useMutation({
    mutationFn: (name: string) =>
      api.post<CommunityDetail>(`${BASE}/${encodeURIComponent(name)}/membership`),
    onSuccess: invalidate,
  })
  const leave = useMutation({
    mutationFn: (name: string) =>
      api.del<CommunityDetail>(`${BASE}/${encodeURIComponent(name)}/membership`),
    onSuccess: invalidate,
  })
  return { join, leave }
}

export function useCreateCommunity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCommunityBody) => api.post<CommunityDetail>(BASE, body),
    onSuccess: () => {
      // 新社群会出现在列表最前面，让首页立刻能看见
      void queryClient.invalidateQueries({ queryKey: ['community', 'list'] })
      // **创建者同时也是第一个成员**，所以 /mine 也变了。
      // 不失效的话，刚建完的社群页会显示"加入社群"而不是"退出社群"——
      // 因为加入状态是从 /mine 推导的，而缓存里还是创建前的列表。
      void queryClient.invalidateQueries({ queryKey: ['community', 'mine'] })
    },
  })
}
