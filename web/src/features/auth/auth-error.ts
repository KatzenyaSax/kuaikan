import { ApiError } from '@/shared/api/api-error'

/** 登录/注册场景下，哪些业务码需要特殊文案（其余直接用后端 message） */
const HINTS: Record<number, string> = {
  40205: '该账号已被封禁，如有疑问请联系管理员',
  40206: '邮箱或密码错误',
  40203: '注册功能暂未开放',
  40202: '发送太频繁了，请稍后再试',
  40201: '验证码错误或已失效',
  40204: '该邮箱已被注册',
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.code === 'number') {
      const hint = HINTS[err.code]
      if (hint) return hint
    }
    return err.message
  }
  return err instanceof Error ? err.message : '未知错误'
}
