import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/shared/api/api-error'
import { useRegister, useSendRegisterCode } from '@/features/auth/api'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/field'

const RESEND_SECONDS = 60
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

type FieldErrors = Partial<Record<'email' | 'password' | 'confirm' | 'nickname' | 'code', string>>

/** 客户端校验：明显的问题不必往返一次后端。后端仍然会再校验一遍（信任边界在服务端） */
function validate(values: {
  email: string
  password: string
  confirm: string
  nickname: string
  code: string
}): FieldErrors {
  const errors: FieldErrors = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = '邮箱格式不正确'
  }
  if (values.nickname.trim().length < 2 || values.nickname.trim().length > 32) {
    errors.nickname = '昵称长度需在 2~32 之间'
  }
  if (values.password.length < PASSWORD_MIN || values.password.length > PASSWORD_MAX) {
    errors.password = `密码长度需在 ${PASSWORD_MIN}~${PASSWORD_MAX} 之间`
  }
  if (values.confirm !== values.password) {
    errors.confirm = '两次输入的密码不一致'
  }
  if (!/^\d{6}$/.test(values.code)) {
    errors.code = '验证码为 6 位数字'
  }
  return errors
}

export function RegisterForm() {
  const navigate = useNavigate()
  const [values, setValues] = useState({ email: '', nickname: '', password: '', confirm: '', code: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<number | null>(null)

  const sendCode = useSendRegisterCode()
  const registerMutation = useRegister()

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [])

  const setField = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setValues((v) => ({ ...v, [key]: next }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const startCountdown = () => {
    setCountdown(RESEND_SECONDS)
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current !== null) window.clearInterval(timerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const onSendCode = () => {
    setFormError(null)
    setInfo(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      setErrors((prev) => ({ ...prev, email: '请先填写正确的邮箱' }))
      return
    }
    sendCode.mutate(
      { email: values.email },
      {
        onSuccess: () => {
          setInfo('验证码已发送，请到邮箱查看（开发环境请打开 MailHog）')
          startCountdown()
        },
        onError: (err) => setFormError(messageOf(err)),
      },
    )
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setInfo(null)
    const found = validate(values)
    if (Object.values(found).some(Boolean)) {
      setErrors(found)
      return
    }
    setErrors({})
    registerMutation.mutate(
      {
        email: values.email,
        password: values.password,
        nickname: values.nickname,
        code: values.code,
      },
      {
        onSuccess: () => {
          // P1.1 不自动登录：先引导到登录页（P1.2 再决定是否改成自动登录）
          navigate(`/login?registered=${encodeURIComponent(values.email)}`)
        },
        onError: (err) => setFormError(messageOf(err)),
      },
    )
  }

  return (
    <div className="mx-auto w-full max-w-[400px] px-6 pb-24 pt-16 md:pt-24">
      <h1 className="m-0 text-title">注册</h1>
      <p className="m-0 mt-2 text-aux leading-[1.7] text-muted-foreground">
        注册后可以发帖、评论与关注。注册功能是否开放由服务端配置控制；若提示“暂未开放”，请联系管理员。
      </p>

      <form className="mt-8" onSubmit={onSubmit} data-testid="register-form" noValidate>
        <div className="space-y-5">
          <Field label="邮箱" error={errors.email}>
            <div className="flex gap-2">
              <Input
                data-testid="field-email"
                className="h-11"
                type="email"
                value={values.email}
                onChange={setField('email')}
                placeholder="you@example.com"
                aria-invalid={Boolean(errors.email)}
                autoComplete="email"
              />
              <Button
                variant="outline"
                className="h-11 shrink-0 px-4 text-aux"
                onClick={onSendCode}
                disabled={countdown > 0 || sendCode.isPending}
                data-testid="btn-send-code"
              >
                {countdown > 0 ? `${countdown}s` : sendCode.isPending ? '发送中' : '获取验证码'}
              </Button>
            </div>
          </Field>

          <Field label="验证码" error={errors.code}>
            <Input
              data-testid="field-code"
              className="h-11"
              inputMode="numeric"
              value={values.code}
              onChange={setField('code')}
              placeholder="6 位数字"
              aria-invalid={Boolean(errors.code)}
            />
          </Field>

          <Field label="昵称" error={errors.nickname}>
            <Input
              data-testid="field-nickname"
              className="h-11"
              value={values.nickname}
              onChange={setField('nickname')}
              placeholder="2~32 个字符"
              aria-invalid={Boolean(errors.nickname)}
            />
          </Field>

          <Field label="密码" error={errors.password}>
            <Input
              data-testid="field-password"
              className="h-11"
              type="password"
              value={values.password}
              onChange={setField('password')}
              placeholder={`${PASSWORD_MIN}~${PASSWORD_MAX} 位`}
              aria-invalid={Boolean(errors.password)}
              autoComplete="new-password"
            />
          </Field>

          <Field label="确认密码" error={errors.confirm}>
            <Input
              data-testid="field-confirm"
              className="h-11"
              type="password"
              value={values.confirm}
              onChange={setField('confirm')}
              aria-invalid={Boolean(errors.confirm)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        {info ? <p className="m-0 mt-4 text-caption text-success">{info}</p> : null}
        {formError ? (
          <p className="m-0 mt-4 text-aux text-danger" data-testid="toast-error">
            {formError}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="mt-7 w-full"
          disabled={registerMutation.isPending}
          data-testid="btn-submit"
        >
          {registerMutation.isPending ? '提交中…' : '注册'}
        </Button>

        <p className="m-0 mt-6 border-t border-border pt-6 text-center text-aux text-muted-foreground">
          已经有账号？
          <Link to="/login" className="ml-1 text-primary underline-offset-[3px] hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-caption text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-caption text-danger">{error}</span> : null}
    </label>
  )
}

/** 把 ApiError 转成用户能看懂的一句话 */
function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return err instanceof Error ? err.message : '未知错误'
}
