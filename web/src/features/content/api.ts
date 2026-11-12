import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

export type PostDetail = OkData<'getPost'>
export type CreatePostBody = RequestBody<'createPost'>
export type UserSummary = OkData<'batchUserSummaries'>[number]

const BASE = '/api/content/posts'

export function usePostDetail(postId: string | undefined) {
  return useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.get<PostDetail>(`${BASE}/${encodeURIComponent(postId ?? '')}`),
    enabled: Boolean(postId),
  })
}

export function useCreatePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePostBody) => api.post<PostDetail>(BASE, body),
    onSuccess: () => {
      // 社群帖列表在 P2.4 才会用同一个 key 拉
      void queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

/**
 * 批量取作者摘要。
 *
 * 帖子详情里**只有 authorId**（ADR 0009），昵称头像要靠这个接口现取。
 * 一屏多个作者也只发一次请求 —— 这正是它存在的理由。
 *
 * 用 staleTime 让作者信息在页面间复用时不必反复拉：昵称头像的变化频率
 * 远低于帖子浏览频率，而"改了昵称马上全站生效"的体验由 P1.6 的
 * 失效逻辑保证（我们这里只缓存几分钟）。
 */
export function useUserSummaries(ids: Array<string | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
  return useQuery({
    queryKey: ['users', unique.join(',')],
    queryFn: () => api.get<UserSummary[]>(`/api/user/users?ids=${unique.map(encodeURIComponent).join(',')}`),
    enabled: unique.length > 0,
    staleTime: 60_000,
  })
}

/** 按 id 取单个作者摘要；查不到时返回 null，由调用方降级成"已注销用户" */
export function pickAuthor(
  summaries: UserSummary[] | undefined,
  userId: string | undefined,
): UserSummary | null {
  if (!summaries || !userId) return null
  return summaries.find((s) => s.userId === userId) ?? null
}
