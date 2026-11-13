import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

export type InteractionState = OkData<'interactionStates'>[number]
export type TargetBody = RequestBody<'likeTarget'>

const BASE = '/api/interaction'

/**
 * 批量查"我对这些目标是什么状态"。登录后才调，游客直接跳过。
 *
 * 一次带上整页的目标：一屏帖子 + 几十条评论只发一次请求。
 * 这是 interaction 的 states 接口存在的全部理由。
 */
export function useInteractionStates(targets: string[], enabled: boolean) {
  const unique = [...new Set(targets)].sort()
  return useQuery({
    queryKey: ['interaction', 'states', unique.join(',')],
    queryFn: () =>
      api.get<InteractionState[]>(
        `${BASE}/states?targets=${unique.map(encodeURIComponent).join(',')}`,
      ),
    enabled: enabled && unique.length > 0,
  })
}

/**
 * 点赞 / 取消。
 *
 * 状态是**同步**的（interaction 直接写事实入库，响应就代表最新状态），
 * 但**计数是异步**的（要等 content 消费事件投影，允许滞后 ≤5s）。
 *
 * 所以这里做两件事：
 *   1. 立即失效 states —— 按钮马上变成正确状态
 *   2. 2 秒后再失效一次详情/评论 —— 那时计数已经被投影过来了
 *      （只失效一次的话，立刻刷新拿到的是旧计数，会看着"点了没反应"）
 */
export function useToggleLike() {
  const queryClient = useQueryClient()
  return useMutation({
    // 取消用 query 参数：DELETE 带 body 在链路上不保证被转发
    mutationFn: ({ liked, body }: { liked: boolean; body: TargetBody }) =>
      liked
        ? api.del<void>(
            `${BASE}/likes?targetType=${encodeURIComponent(body.targetType)}&targetId=${encodeURIComponent(body.targetId)}`,
          )
        : api.post<void>(`${BASE}/likes`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['interaction', 'states'] })
      void queryClient.invalidateQueries({ queryKey: ['post'] })
      void queryClient.invalidateQueries({ queryKey: ['comments'] })
      void queryClient.invalidateQueries({ queryKey: ['replies'] })
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['post'] })
        void queryClient.invalidateQueries({ queryKey: ['comments'] })
        void queryClient.invalidateQueries({ queryKey: ['replies'] })
      }, 2000)
    },
  })
}

/** 收藏 / 取消。只有帖子可以收藏 */
export function useToggleFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ favorited, body }: { favorited: boolean; body: TargetBody }) =>
      favorited
        ? api.del<void>(
            `${BASE}/favorites?targetType=${encodeURIComponent(body.targetType)}&targetId=${encodeURIComponent(body.targetId)}`,
          )
        : api.post<void>(`${BASE}/favorites`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['interaction', 'states'] })
      void queryClient.invalidateQueries({ queryKey: ['post'] })
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['post'] })
      }, 2000)
    },
  })
}
