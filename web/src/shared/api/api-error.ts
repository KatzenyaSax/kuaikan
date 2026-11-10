/**
 * 统一的接口错误。
 *
 * code：后端业务码（如 40100 / 42900），网络层错误时为字符串 'NETWORK' / 'TIMEOUT'
 * status：HTTP 状态码，网络层错误时为 0
 */
export type ApiErrorCode = number | 'NETWORK' | 'TIMEOUT' | 'BAD_RESPONSE'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    // 兼容 ES5 目标下的原型链，虽然当前 target 是 ES2022
    Object.setPrototypeOf(this, ApiError.prototype)
  }

  /** 未登录或登录已过期 */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 40100
  }

  /** 被限流 */
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 42900
  }
}
