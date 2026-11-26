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
  40207: '原密码错误', // PASSWORD_INCORRECT
  40208: '新密码不能与原密码相同', // PASSWORD_UNCHANGED
  40209: '用户不存在', // USER_NOT_FOUND
  40210: '不能关注自己', // CANNOT_FOLLOW_SELF
  40211: '关注人数已达上限', // FOLLOW_LIMIT_EXCEEDED
  40300: '没有权限', // FORBIDDEN
  40400: '资源不存在', // NOT_FOUND
  40900: '状态冲突', // CONFLICT
  41001: '社群不存在', // COMMUNITY_NOT_FOUND
  41002: '该社群名称已被使用', // COMMUNITY_NAME_TAKEN
  41004: '需要先加入社群', // NOT_MEMBER
  41005: '社群创建者不能退出', // OWNER_CANNOT_LEAVE
  41006: '你已被该社群封禁', // COMMUNITY_BANNED
  41007: '只有社群管理员可以执行此操作', // NOT_COMMUNITY_ADMIN
  41008: '不能封禁社群管理员', // CANNOT_BAN_ADMIN
  41009: '只能将管理员转让给本社群在社成员', // TRANSFER_TARGET_INVALID
  42001: '帖子不存在', // POST_NOT_FOUND
  42002: '评论不存在', // COMMENT_NOT_FOUND
  42900: '请求过于频繁', // RATE_LIMITED
  44001: '今日 AI 对话次数已用完', // AI_QUOTA_EXCEEDED
  44002: '已有正在进行的回答，请稍候', // AI_STREAM_BUSY
  44003: 'AI 服务暂时不可用', // AI_UNAVAILABLE
  44004: '对话不存在或无权访问', // AI_CONVERSATION_NOT_FOUND
  44005: '该操作提议已过期，请重新发起', // AI_ACTION_EXPIRED
  44006: '操作提议状态不允许此操作', // AI_ACTION_STATE_INVALID
  44007: '个人 AI 档案条目已达上限（最多 30 条）', // AI_PROFILE_LIMIT_EXCEEDED
  44008: '档案条目不存在或无权访问', // AI_PROFILE_NOT_FOUND
  44009: '个人笔记数量已达上限（最多 200 篇）', // AI_NOTE_LIMIT_EXCEEDED
  44010: '笔记不存在或无权访问', // AI_NOTE_NOT_FOUND
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
  40207: 200,
  40208: 200,
  40209: 404,
  40210: 200,
  40211: 200,
  40300: 403,
  40400: 404,
  40900: 409,
  41001: 404,
  41002: 409,
  41004: 200,
  41005: 200,
  41006: 403,
  41007: 403,
  41008: 200,
  41009: 200,
  42001: 404,
  42002: 404,
  42900: 429,
  44001: 429,
  44002: 409,
  44003: 503,
  44004: 404,
  44005: 200,
  44006: 409,
  44007: 200,
  44008: 404,
  44009: 200,
  44010: 404,
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
