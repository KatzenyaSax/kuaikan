import { QueryClient } from '@tanstack/react-query'

/**
 * 数据分层纪律（违反即返工）：
 *
 *   服务端返回的一切  →  TanStack Query   （用户、帖子、评论、服务状态…）
 *   纯 UI 态          →  Zustand          （弹窗、侧栏、主题）
 *   会话态            →  Zustand，但只是 Query 的镜像，不作为数据源
 *
 * 禁止把服务端数据塞进 Zustand。理由：Query 负责缓存、失效、重试、去重，
 * 手工在 store 里重建这些能力必然做错，最后变成两份互相打架的真相。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 计数类数据允许滞后（architecture §10 不变量 5），但 UI 侧不重复请求
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
