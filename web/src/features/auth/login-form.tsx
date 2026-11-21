import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/field'

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
    <div className="mx-auto max-w-[24rem] px-6 pt-16">
      <h1 className="m-0 mb-6 text-title font-[640]">登录</h1>

      {logoutReason === 'banned' ? (
        <p className="m-0 mb-4 text-aux text-danger" data-testid="session-notice">
          账号已被封禁，如有疑问请联系管理员。
        </p>
      ) : logoutReason === 'expired' ? (
        <p className="m-0 mb-4 text-aux text-warning" data-testid="session-notice">
          登录状态已过期，请重新登录。
        </p>
      ) : logoutReason === 'password_changed' ? (
        // 改密成功必然全端下线：这句话必须出现在**登录页本身**。
        // 从前它靠 router location.state 传递，被 RequireAuth 的同帧重定向抹掉，
        // 用户只看到一个空白登录页（以为改密失败了）。现在改走 store 的 logoutReason。
        <p className="m-0 mb-4 text-aux text-success" data-testid="login-notice">
          密码已修改，请使用新密码重新登录
        </p>
      ) : null}

      {params.get('registered') ? (
        <p className="m-0 mb-4 text-aux text-success">
          注册成功，请用刚才的邮箱登录。
        </p>
      ) : null}

      <form className="mt-0 space-y-4" onSubmit={onSubmit} data-testid="login-form" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-caption text-faint">邮箱</span>
          <Input
            data-testid="field-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-caption text-faint">密码</span>
          <Input
            data-testid="field-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <p className="m-0 text-aux text-danger" data-testid="toast-error">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy} data-testid="btn-submit">
          {busy ? '登录中…' : '登录'}
        </Button>

        <p className="m-0 text-center text-aux text-muted-foreground">
          还没有账号？
          <Link to="/register" className="ml-1 text-primary hover:underline">
            去注册
          </Link>
        </p>
      </form>
    </div>
  )
}

