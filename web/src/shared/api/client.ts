import { ApiError } from '@/shared/api/api-error'
import { apiBaseUrl } from '@/shared/lib/env'

/**
 * 后端统一响应信封。解包**只允许发生在本文件**，组件里不得直接读 `body.code`。
 */
type Envelope<T> = { code: number; message: string; data: T }

const SUCCESS_CODE = 0

/** P1 接入后由会话层注册「refresh 失败，需要重新登录」的处理动作 */
type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 默认 10 秒；SSE 等长连接不走这里 */
  timeoutMs?: number
}

function buildHeaders(opts: RequestOptions): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'number' &&
    'message' in value
  )
}

/**
 * 发起请求并解包 `Result<T>`。
 *
 * 契约（见 docs/design/p05-frontend.md）：
 *   - HTTP 状态码只表达传输层语义（401/403/429/500）
 *   - 业务错误一律 HTTP 2xx + code != 0
 *   - 所有请求默认带 credentials: 'include'（P1 的 refresh cookie 依赖它）
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/')) {
    throw new Error(`请求路径必须以 /api/ 开头，实际：${path}`)
  }

  const timeoutMs = opts.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // 调用方传了 signal 就把它接进来，两者任一触发都取消
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort()
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: buildHeaders(opts),
      // exactOptionalPropertyTypes 下 body 不接受 undefined；RequestInit 允许 null
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      signal: controller.signal,
      credentials: 'include',
    })
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    throw new ApiError(aborted ? 'TIMEOUT' : 'NETWORK', aborted ? '请求超时' : '网络不可达', 0)
  } finally {
    clearTimeout(timer)
  }

  // 401：先走会话层的处理动作，再把错误抛给调用方
  if (response.status === 401) {
    unauthorizedHandler?.()
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // 非 JSON（例如网关直接返回的空 404），下面按状态码处理
  }

  if (isEnvelope(body)) {
    if (body.code === SUCCESS_CODE) {
      return body.data as T
    }
    throw new ApiError(body.code, body.message, response.status)
  }

  if (!response.ok) {
    throw new ApiError('BAD_RESPONSE', `HTTP ${String(response.status)}`, response.status)
  }

  throw new ApiError('BAD_RESPONSE', '响应不是约定的 Result 信封', response.status)
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
}
