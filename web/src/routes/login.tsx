import { LoginForm } from '@/features/auth/login-form'

/**
 * 登录页。
 *
 * 这里只渲染表单本身：所有"为什么你会在登录页"的提示（封禁 / 过期 / 改密成功）
 * 都由 `LoginForm` 从会话 store 的 `logoutReason` 读取，并复用既有的
 * `session-notice` / `login-notice` 两个 data-testid。
 *
 * 曾经这里叠过一层从 `location.state.notice` 读的提示条，两个问题：
 *   1. `<RequireAuth>` 在 clear() 之后的同帧重定向会把 location.state 覆盖掉，
 *      提示永远看不到；
 *   2. 那层自带 pt-16，与 LoginForm 的 pt-16 叠成 128px 的空白。
 */
export function LoginPage() {
  return <LoginForm />
}
