import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { cn } from '@/shared/lib/cn'

export function LoginForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useSession((s) => s.login)
  const logoutReason = useSession((s) => s.logoutReason)

  const [email, setEmail] = useState(params.get('registered') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const returnTo = params.get('returnTo') ?? '/me'

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardTitle>登录</CardTitle>

      {logoutReason === 'banned' ? (
        <CardDescription className="mt-1 text-danger" data-testid="session-notice">
          账号已被封禁，如有疑问请联系管理员。
        </CardDescription>
      ) : logoutReason === 'expired' ? (
        <CardDescription className="mt-1 text-warning" data-testid="session-notice">
          登录状态已过期，请重新登录。
        </CardDescription>
      ) : null}

      {params.get('registered') ? (
        <CardDescription className="mt-1 text-success">
          注册成功，请用刚才的邮箱登录。
        </CardDescription>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={onSubmit} data-testid="login-form" noValidate>
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">邮箱</span>
          <input
            data-testid="field-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass()}
            autoComplete="username"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-muted-foreground">密码</span>
          <input
            data-testid="field-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass()}
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <p className="text-[11px] text-danger" data-testid="toast-error">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy} data-testid="btn-submit">
          {busy ? '登录中…' : '登录'}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          还没有账号？
          <Link to="/register" className="ml-1 text-primary hover:underline">
            去注册
          </Link>
        </p>
      </form>
    </Card>
  )
}

function inputClass(): string {
  return cn(
    'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none',
    'focus-visible:ring-2 focus-visible:ring-primary',
  )
}
