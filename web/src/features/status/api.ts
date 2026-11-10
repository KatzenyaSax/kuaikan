import { useQueries } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ApiError } from '@/shared/api/api-error'
import type { operations as communityOps } from '@/shared/api/types/community-service.gen'
import type { operations as contentOps } from '@/shared/api/types/content-service.gen'
import type { operations as interactionOps } from '@/shared/api/types/interaction-service.gen'
import type { operations as notificationOps } from '@/shared/api/types/notification-service.gen'
import type { operations as rankOps } from '@/shared/api/types/rank-service.gen'
import type { operations as searchOps } from '@/shared/api/types/search-service.gen'
import type { operations as userOps } from '@/shared/api/types/user-service.gen'

/** 从生成的 operations 里取出某个接口 200 响应的 data 字段类型 */
type DataOf<O, K extends PropertyKey> = O extends Record<
  K,
  { responses: { 200: { content: { '*/*': { data?: infer D } } } } }
>
  ? NonNullable<D>
  : never

/**
 * 七个服务的 /ping 返回结构必须完全一致 —— 否则下面的「用一份类型代表全部」就是错的。
 *
 * 这个断言在编译期生效：只要有任何一份 spec 与 user-service 不同，
 * 对应元素会变成 false，泛型约束不满足，typecheck 直接报错。
 * 用 `satisfies` 式的思路，但不需要任何运行时代码。
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AllTrue<T extends readonly true[]> = T

export type PingDataIdentical = AllTrue<
  [
    Same<DataOf<userOps, 'ping'>, DataOf<communityOps, 'ping'>>,
    Same<DataOf<userOps, 'ping'>, DataOf<contentOps, 'ping'>>,
    Same<DataOf<userOps, 'ping'>, DataOf<interactionOps, 'ping'>>,
    Same<DataOf<userOps, 'ping'>, DataOf<notificationOps, 'ping'>>,
    Same<DataOf<userOps, 'ping'>, DataOf<searchOps, 'ping'>>,
    Same<DataOf<userOps, 'ping'>, DataOf<rankOps, 'ping'>>,
  ]
>

/** 规范化之后，用 user-service 的类型代表全部（上面的断言保证了这是安全的） */
export type PingData = DataOf<userOps, 'ping'>

export type ServiceKey =
  | 'user'
  | 'community'
  | 'content'
  | 'interaction'
  | 'notification'
  | 'search'
  | 'rank'

export type ServiceDef = {
  key: ServiceKey
  label: string
  path: string
}

export const SERVICE_DEFS: readonly ServiceDef[] = [
  { key: 'user', label: 'user-service', path: '/api/user/ping' },
  { key: 'community', label: 'community-service', path: '/api/community/ping' },
  { key: 'content', label: 'content-service', path: '/api/content/ping' },
  { key: 'interaction', label: 'interaction-service', path: '/api/interaction/ping' },
  { key: 'notification', label: 'notification-service', path: '/api/notification/ping' },
  { key: 'search', label: 'search-service', path: '/api/search/ping' },
  { key: 'rank', label: 'rank-service', path: '/api/rank/ping' },
] as const

export type ProbeResult = {
  service: string
  host: string
  port: string
  latencyMs: number
}

/**
 * 打一次 /ping 并测量耗时。
 *
 * 生成类型里 data 是 `{ [key: string]: unknown }`，所以字段存在性必须在运行时收口——
 * 这里不是防御性编程，而是把「后端契约」转换成「前端可以安全渲染的形状」的唯一位置。
 */
async function probe(def: ServiceDef): Promise<ProbeResult> {
  const startedAt = performance.now()
  const data = await api.get<PingData>(def.path)
  const latencyMs = Math.round(performance.now() - startedAt)

  const service = data['service']
  const host = data['host']
  const port = data['port']

  if (typeof service !== 'string' || typeof host !== 'string' || typeof port !== 'string') {
    throw new ApiError('BAD_RESPONSE', '/ping 响应缺少 service / host / port', 0)
  }

  return { service, host, port, latencyMs }
}

const REFETCH_INTERVAL_MS = 10_000

export function useServiceProbes() {
  return useQueries({
    queries: SERVICE_DEFS.map((def) => ({
      queryKey: ['service-ping', def.key] as const,
      queryFn: () => probe(def),
      refetchInterval: REFETCH_INTERVAL_MS,
      // 计数类数据允许滞后，但这里要的是"当前是否活着"，过期时间不宜太长
      staleTime: 5_000,
    })),
  })
}

export const REFETCH_SECONDS = REFETCH_INTERVAL_MS / 1000
