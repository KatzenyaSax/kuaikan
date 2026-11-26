import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'

export type SearchPageResult = OkData<'searchPosts'>
export type SearchItem = NonNullable<SearchPageResult['items']>[number]
export type RelatedPostItem = OkData<'relatedPosts'>[number]

/** 排序：相关性（默认）/ 最新。未知值会被后端判 40010 */
export type SearchSort = 'relevance' | 'latest'

export const PAGE_SIZE = 20

/**
 * 全站帖子搜索（p6-search.md §5.1）。**游客可读**，不需要登录态。
 *
 * 三点必须记住：
 *
 * 1. **游标是不透明的**：只回传 `nextCursor`，不解析、不拼。服务端把排序标记
 *    编进了游标，跨排序复用会被明确拒绝（40010）。
 * 2. **q / sort / communityId 全部进 queryKey**：任何一个变了就是另一份结果集，
 *    缓存不能串。游标本身不进 key（它在 pageParam 里，由 useInfiniteQuery 管）。
 * 3. **关键词为空时不发请求**（enabled=false）：空 q 后端会判 40010，
 *    前端在引导态里根本不该产生这个请求。trim 之后再判断，避免" "这种假输入。
 *
 * 高亮**不在前端做**：后端返回的是 `\uE000...\uE001` 包裹的 `titleHighlight` /
 * `bodySnippet`，由 `HighlightedText` 切成文本与 `<mark>`。
 */
export function useSearchPosts({
  q,
  sort,
  communityId,
}: {
  q: string
  sort: SearchSort
  communityId: string
}) {
  const keyword = q.trim()
  return useInfiniteQuery({
    queryKey: ['search', 'posts', { q: keyword, sort, communityId }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ q: keyword, sort, limit: String(PAGE_SIZE) })
      if (communityId) params.set('communityId', communityId)
      if (pageParam) params.set('cursor', pageParam)
      return api.get<SearchPageResult>(`/api/search/posts?${params.toString()}`)
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: keyword.length > 0,
    // 搜索结果只有"新帖入索引"会变，没必要切回来就重查
    staleTime: 60_000,
  })
}

/**
 * 帖子详情页「相关帖子」推荐（P9.1）：游客可读，失败或降级时静默返回空数组。
 */
export function useRelatedPosts(postId: string | undefined) {
  return useQuery({
    queryKey: ['search', 'related', postId],
    queryFn: async () => {
      try {
        return await api.get<RelatedPostItem[]>(
          `/api/search/posts/${encodeURIComponent(postId!)}/related?limit=5`,
        )
      } catch {
        return []
      }
    },
    enabled: Boolean(postId),
    staleTime: 120_000,
    retry: false,
  })
}
