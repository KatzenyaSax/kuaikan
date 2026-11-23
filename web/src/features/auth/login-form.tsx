import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Field, Input } from '@/shared/ui/field'
import { Toast } from '@/shared/ui/toast'

export function LoginForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useSession((s) => s.login)
  const logoutReason = useSession((s) => s.logoutReason)
  const clearSession = useSession((s) => s.clear)
  const clearLogoutReason = () => clearSession(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const returnTo = params.get('returnTo')
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      void navigate(safeReturnTo, { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card padding="lg" strong className="mx-auto w-full max-w-md rounded-3xl">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandMark size={48} className="mb-3" />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
          欢迎回到 <span className="text-aurora">kuaikan</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">使用邮箱登录你的极光社群空间</p>
      </div>

      <div className="mb-4 space-y-2.5">
        {logoutReason === 'password_changed' && (
          <Toast
            tone="success"
            message="密码已修改，全部设备已安全退出，请使用新密码重新登录。"
            testId="login-notice"
            onClose={clearLogoutReason}
          />
        )}
        {logoutReason === 'banned' && (
          <Toast
            tone="danger"
            message="该账号已被封禁，暂无法登录。你仍可以游客身份浏览全部公开内容。"
            testId="session-notice"
            onClose={clearLogoutReason}
          />
        )}
        {logoutReason === 'expired' && (
          <Toast
            tone="info"
            message="登录状态已过期，请重新登录。"
            testId="session-notice"
            onClose={clearLogoutReason}
          />
        )}
        {error && <Toast tone="danger" message={error} testId="toast-error" />}
      </div>

      <form data-testid="login-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Field label="邮箱地址" htmlFor="login-email">
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              data-testid="field-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="pl-10"
              required
            />
          </div>
        </Field>

        <Field label="登录密码" htmlFor="login-password">
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              data-testid="field-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              className="pl-10"
              required
            />
          </div>
        </Field>

        <Button
          type="submit"
          size="lg"
          data-testid="btn-submit"
          disabled={submitting}
          className="mt-2 w-full"
        >
          <span>{submitting ? '正在验证身份…' : '登录'}</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        还没有账号？{' '}
        <Link to="/register" className="font-semibold text-primary hover:underline">
          立即注册
        </Link>
      </p>
    </Card>
  )
}
