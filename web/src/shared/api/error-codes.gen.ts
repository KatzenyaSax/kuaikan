/* eslint-disable */
/**
 * 本文件由 `npm run gen:contract` 从 contract/error-codes.json 生成，禁止手改。
 * 后端改动错误码后请同步 contract/error-codes.json 并重新生成。
 */

/** 业务码 → 用户可读文案。缺项时由 resolveErrorMessage 兜底。 */
export const ERROR_MESSAGES: Readonly<Record<number, string>> = {
  40000: '请求参数不合法', // BAD_REQUEST
  40010: '字段校验未通过', // PARAM_INVALID
  40100: '未登录或登录已过期', // UNAUTHORIZED
  40201: '验证码错误或已失效', // CODE_INVALID
  40202: '验证码发送过于频繁，请稍后再试', // CODE_TOO_FREQUENT
  40203: '注册功能暂未开放', // REGISTER_DISABLED
  40204: '该邮箱已被注册', // EMAIL_TAKEN
  40205: '账号已被封禁', // ACCOUNT_BANNED
  40206: '邮箱或密码错误', // CREDENTIALS_INVALID
  40300: '没有权限', // FORBIDDEN
  40400: '资源不存在', // NOT_FOUND
  40900: '状态冲突', // CONFLICT
  41001: '社群不存在', // COMMUNITY_NOT_FOUND
  41002: '该社群标识已被占用', // COMMUNITY_SLUG_TAKEN
  41004: '需要先加入社群', // NOT_MEMBER
  42001: '帖子不存在', // POST_NOT_FOUND
  42900: '请求过于频繁', // RATE_LIMITED
  50000: '服务内部错误', // INTERNAL
  50300: '服务暂时不可用', // UPSTREAM_UNAVAILABLE
} as const

/** 业务码 → HTTP 状态码。用于断言前后端对同一场景的状态码认知一致。 */
export const ERROR_HTTP_STATUS: Readonly<Record<number, number>> = {
  40000: 200,
  40010: 200,
  40100: 401,
  40201: 200,
  40202: 429,
  40203: 403,
  40204: 200,
  40205: 403,
  40206: 200,
  40300: 403,
  40400: 404,
  40900: 409,
  41001: 404,
  41002: 409,
  41004: 200,
  42001: 404,
  42900: 429,
  50000: 500,
  50300: 503,
} as const

export function resolveErrorMessage(code: number | string, fallback: string): string {
  if (typeof code === 'number') {
    const hit = ERROR_MESSAGES[code]
    if (hit) return hit
  }
  return fallback
}
