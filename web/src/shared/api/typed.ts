import type { operations } from '@/shared/api/types/user-service.gen'

/**
 * 从生成的 operations 里取出某个接口的**解包后** data 类型。
 *
 * 后端统一返回 Result<T>，client.ts 已经解包，所以业务代码拿到的就是 data。
 * 这里把「信封 → data」的推导集中一次，避免各处手写 NonNullable<...>。
 */
export type OkData<Op extends keyof operations> = operations[Op] extends {
  responses: { 200: { content: { '*/*': { data?: infer D } } } }
}
  ? NonNullable<D>
  : never

/** 请求体类型 */
export type RequestBody<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : never
