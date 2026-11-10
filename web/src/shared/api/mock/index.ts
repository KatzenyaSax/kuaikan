/**
 * 前端 mock 基座。
 *
 * 启用方式：`VITE_API_MOCK=1 npm run dev`
 *
 * 关键约束：**mock 的返回值必须满足 OpenAPI 生成的类型**。
 * 后端改了契约而 mock 没跟上时，`npm run typecheck` 会直接报错——
 * 这样 mock 不可能静默漂移成"假事实"。
 *
 * 为什么不用 MSW：它需要 service worker，为 P1 这点量不值当；
 * 而手写 mock 被生成类型约束，反而更难漂移。
 */
import type { ApiErrorCode } from '@/shared/api/api-error'

export type MockRequest = {
  method: string
  /** 去掉查询串的路径，例如 /api/user/auth/me */
  path: string
  body: unknown
}

export type MockResult =
  | { ok: true; data: unknown }
  | { ok: false; code: ApiErrorCode; message: string; status: number }

type Handler = (req: MockRequest) => MockResult | Promise<MockResult>

type Route = {
  method: string
  /** 支持 :param 占位，例如 /api/user/auth/sessions/:jti */
  pattern: string
  handler: Handler
  /** 延迟毫秒，用于观察加载态。mockRoute 总会给默认值，故这里是必填 */
  delayMs: number
}

const routes: Route[] = []

export function mockRoute(
  method: string,
  pattern: string,
  handler: Handler,
  delayMs = 120,
): void {
  routes.push({ method: method.toUpperCase(), pattern, handler, delayMs })
}

function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/')
  const sp = path.split('/')
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i += 1) {
    const a = pp[i]
    const b = sp[i]
    if (a === undefined || b === undefined) return null
    if (a.startsWith(':')) {
      params[a.slice(1)] = decodeURIComponent(b)
    } else if (a !== b) {
      return null
    }
  }
  return params
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 查找并执行 mock。
 *
 * 未命中时**直接抛错而不是回落到真实网络**：mock 模式下打到真实后端会让
 * "为什么这个页面数据是真的、那个是假的"变得无法解释。宁可显式失败。
 */
export async function resolveMock(req: MockRequest): Promise<unknown> {
  for (const route of routes) {
    if (route.method !== req.method.toUpperCase()) continue
    const params = match(route.pattern, req.path)
    if (!params) continue
    if (route.delayMs > 0) await delay(route.delayMs)
    const result = await route.handler(req)
    if (result.ok) return result.data
    const { ApiError } = await import('@/shared/api/api-error')
    throw new ApiError(result.code, result.message, result.status)
  }
  throw new Error(
    `mock 未覆盖该请求：${req.method} ${req.path}。` +
      `请在 src/shared/api/mock/index.ts 里补一条 mockRoute，或用 VITE_API_MOCK=0 关掉 mock。`,
  )
}

export function listMockRoutes(): string[] {
  return routes.map((r) => `${r.method} ${r.pattern}`)
}

// ---------------------------------------------------------------- 内置示例
// P1.0 只放一条，用来证明 mock 通道本身可用；auth 相关的 mock 由 P1.1/P1.2 补。
mockRoute('GET', '/api/user/ping', () => ({
  ok: true,
  data: {
    service: 'user-service (mock)',
    port: '8081',
    host: 'mock-host',
    java: '21',
    time: new Date().toISOString(),
  },
}))
