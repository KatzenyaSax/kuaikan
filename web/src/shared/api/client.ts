import { ApiError } from '@/shared/api/api-error'
import { apiBaseUrl } from '@/shared/lib/env'

/**
 * 后端统一响应信封。解包**只允许发生在本文件**，组件里不得直接读 `body.code`。
 */
type Envelope<T> = { code: number; message: string; data: T }

const SUCCESS_CODE = 0

// ---------------------------------------------------------------- 会话接线
//
// client 不能直接 import 会话 store（会形成 client → store → client 的循环）。
// 所以反过来：由会话模块在初始化时把下面三个函数注册进来。

type TokenProvider = () => string | null
type RefreshFn = () => Promise<string | null>

let getToken: TokenProvider = () => null
let refreshTokens: RefreshFn | null = null
let onUnauthorized: (() => void) | null = null

export function configureAuth(opts: {
  getToken: TokenProvider
  refresh?: RefreshFn
  onUnauthorized?: () => void
}): void {
  getToken = opts.getToken
  if (opts.refresh) refreshTokens = opts.refresh
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized
}

/**
 * single-flight 续期。
 *
 * 页面同时发 7 个请求全部 401 时，如果每个都去 refresh，会因 refresh 轮换
 * 把彼此作废，最后把用户踢下线。所以只允许一个 refresh 在飞，其余请求等它的结果。
 */
let inFlightRefresh: Promise<string | null> | null = null

function refreshOnce(): Promise<string | null> {
  if (!refreshTokens) return Promise.resolve(null)
  if (!inFlightRefresh) {
    inFlightRefresh = refreshTokens().finally(() => {
      inFlightRefresh = null
    })
  }
  return inFlightRefresh
}

// ---------------------------------------------------------------- 请求

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 默认 10 秒；SSE 等长连接不走这里 */
  timeoutMs?: number
  /** 内部使用：跳过 401 自动续期（续期请求自己必须跳过，否则递归） */
  skipAuthRetry?: boolean
}

function buildHeaders(opts: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
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

async function sendOnce(path: string, opts: RequestOptions): Promise<{ status: number; body: unknown }> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

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

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // 非 JSON（例如网关直接返回的空 404）
  }
  return { status: response.status, body }
}

/**
 * 发起请求并解包 `Result<T>`。
 *
 * 契约（见 docs/design/p05-frontend.md）：
 *   - HTTP 状态码只表达传输层语义（401/403/429/500）
 *   - 业务错误一律 HTTP 2xx + code != 0
 *   - 所有请求默认带 credentials: 'include'（refresh cookie 依赖它）
 *   - 401 时自动尝试一次续期并重放原请求（single-flight）
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/')) {
    throw new Error(`请求路径必须以 /api/ 开头，实际：${path}`)
  }

  let { status, body } = await sendOnce(path, opts)

  // 401：先尝试续期一次，成功则重放；失败或不能续期才走登出流程
  if (status === 401 && !opts.skipAuthRetry) {
    const newToken = await refreshOnce()
    if (newToken) {
      ;({ status, body } = await sendOnce(path, opts))
    }
    if (status === 401) {
      onUnauthorized?.()
    }
  }

  if (isEnvelope(body)) {
    if (body.code === SUCCESS_CODE) {
      return body.data as T
    }
    throw new ApiError(body.code, body.message, status)
  }

  if (status !== 200 && status !== 0) {
    throw new ApiError('BAD_RESPONSE', `HTTP ${String(status)}`, status)
  }

  throw new ApiError('BAD_RESPONSE', '响应不是约定的 Result 信封', status)
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}
