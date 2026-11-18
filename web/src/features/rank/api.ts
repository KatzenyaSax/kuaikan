import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'

export type HotPage = OkData<'hotRank'>
export type HotItem = NonNullable<HotPage['items']>[number]
export type HotRange = 'day' | 'week'

/**
 * 热榜。
 *
 * 后端的重建周期是 5 分钟，所以这里不需要频繁轮询——
 * `staleTime` 设 60 秒：切 tab 回来不会立刻重查，但也不会拿着十分钟前的数据不放。
 */
export function useHotRank(range: HotRange) {
  return useQuery({
    queryKey: ['hot', range],
    queryFn: () => api.get<HotPage>(`/api/rank/hot?range=${range}`),
    staleTime: 60_000,
  })
}
