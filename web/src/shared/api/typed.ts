import type { operations as communityOps } from '@/shared/api/types/community-service.gen'
import type { operations as contentOps } from '@/shared/api/types/content-service.gen'
import type { operations as interactionOps } from '@/shared/api/types/interaction-service.gen'
import type { operations as notificationOps } from '@/shared/api/types/notification-service.gen'
import type { operations as rankOps } from '@/shared/api/types/rank-service.gen'
import type { operations as searchOps } from '@/shared/api/types/search-service.gen'
import type { operations as userOps } from '@/shared/api/types/user-service.gen'

/**
 * 所有服务的 `operations` 合并成一张表。
 *
 * 为什么合并而不是按服务分别用：调用方只关心「这个接口返回什么」，
 * 不关心它在哪个服务的 spec 里。`OkData<'createPost'>` 应该直接可用，
 * 而不是 `OkData<'content', 'createPost'>` 再手写一次服务名——
 * 服务名写错了 TypeScript 反而不会报错（union 里有兜底）。
 *
 * 用交叉类型合并而不是 `Spec[keyof Spec]`：后者得到的是**所有 value 的联合**，
 * 取一个 key 会得到一堆不相关的类型。
 *
 * ⚠️ **operationId 必须在所有 spec 之间唯一。** 交叉类型合并时同名属性会被
 * 合并成 `A & B`，如果两个形状兼容，TypeScript 会照常编译通过，只是类型
 * 悄悄指到了另一个服务。这个静默错误由 `deploy/bin/check-openapi.mjs` 拦截，
 * 所以它必须在每次 `gen:types` 之后跑。
 */
export type ApiOperations = userOps &
  communityOps &
  contentOps &
  interactionOps &
  notificationOps &
  searchOps &
  rankOps

/**
 * 从生成的 operations 里取出某个接口的**解包后** data 类型。
 *
 * 后端统一返回 Result<T>，client.ts 已经解包，所以业务代码拿到的就是 data。
 * 这里把「信封 → data」的推导集中一次，避免各处手写 NonNullable<...>。
 */
export type OkData<Op extends keyof ApiOperations> = ApiOperations[Op] extends {
  responses: { 200: { content: { '*/*': { data?: infer D } } } }
}
  ? NonNullable<D>
  : never

/** 请求体类型 */
export type RequestBody<Op extends keyof ApiOperations> = ApiOperations[Op] extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : never
