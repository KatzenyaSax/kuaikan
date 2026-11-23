import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, KeyRound, Lock, Mail, Sparkles, User } from 'lucide-react'
import { useRegister, useSendRegisterCode } from '@/features/auth/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Field, Input } from '@/shared/ui/field'
import { Toast } from '@/shared/ui/toast'

export function RegisterForm() {
  const navigate = useNavigate()
  const sendCode = useSendRegisterCode()
  const register = useRegister()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => window.clearInterval(t)
  }, [cooldown])

  const handleSendCode = () => {
    setError(null)
    setInfo(null)
    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setError('请先填写邮箱地址')
      return
    }
    sendCode.mutate(
      { email: cleanEmail },
      {
        onSuccess: () => {
          setCooldown(60)
          setInfo('验证码已发送，请检查你的邮箱收件箱')
        },
        onError: (err) => {
          setError(authErrorMessage(err))
        },
      },
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('密码长度至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    register.mutate(
      {
        email: email.trim(),
        code: code.trim(),
        nickname: nickname.trim(),
        password,
      },
      {
        onSuccess: () => {
          void navigate('/login', { replace: true })
        },
        onError: (err) => {
          setError(authErrorMessage(err))
        },
      },
    )
  }

  return (
    <Card padding="lg" strong className="mx-auto w-full max-w-md rounded-3xl">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandMark size={48} className="mb-3" />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
          加入 <span className="text-aurora">kuaikan</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">注册后即可加入社群、发帖互动与接收实时推送</p>
      </div>

      <div className="mb-4 space-y-2">
        {info && <Toast tone="success" message={info} onClose={() => setInfo(null)} />}
        {error && <Toast tone="danger" message={error} testId="toast-error" />}
      </div>

      <form data-testid="register-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="邮箱地址" htmlFor="reg-email">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reg-email"
                type="email"
                data-testid="field-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="pl-10"
                required
              />
            </div>
            <Button
              variant="secondary"
              data-testid="btn-send-code"
              disabled={cooldown > 0 || sendCode.isPending}
              onClick={handleSendCode}
              className="shrink-0"
            >
              {cooldown > 0 ? `${String(cooldown)}s` : sendCode.isPending ? '发送中' : '发验证码'}
            </Button>
          </div>
        </Field>

        <Field label="邮箱验证码" htmlFor="reg-code">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="reg-code"
              data-testid="field-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位数字验证码"
              className="pl-10 font-mono"
              required
            />
          </div>
        </Field>

        <Field label="昵称" htmlFor="reg-nick">
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="reg-nick"
              data-testid="field-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="大家将如何称呼你"
              className="pl-10"
              maxLength={32}
              required
            />
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="设置密码" htmlFor="reg-pwd">
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reg-pwd"
                type="password"
                data-testid="field-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                className="pl-10"
                minLength={8}
                required
              />
            </div>
          </Field>

          <Field label="确认密码" htmlFor="reg-confirm">
            <div className="relative">
              <Sparkles className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reg-confirm"
                type="password"
                data-testid="field-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再输入一次"
                className="pl-10"
                minLength={8}
                required
              />
            </div>
          </Field>
        </div>

        <Button
          type="submit"
          size="lg"
          data-testid="btn-submit"
          disabled={register.isPending}
          className="mt-2 w-full"
        >
          <span>{register.isPending ? '正在注册…' : '完成注册'}</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        已有账号？{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          直接登录
        </Link>
      </p>
    </Card>
  )
}
