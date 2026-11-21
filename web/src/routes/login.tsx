import { useLocation } from 'react-router'
import { LoginForm } from '@/features/auth/login-form'

/**
 * 登录页。
 *
 * 支持一句来自别处的说明文案（`location.state.notice`）——目前唯一的来源是
 * 「修改密码成功后全端下线」（p55-social.md §6.2）：
 * 那次跳转不能只给一个空白的登录页，否则用户会以为刚才的操作失败了。
 *
 * 为什么放 `state` 而不是 query：它是**一次性**的提示，不该出现在地址栏里，
 * 也不该在刷新/分享链接后重复出现。query 只在 `?registered=` 这种
 * 「这个链接本身有意义」的场景使用。
 *
 * 这里刻意不改 `LoginForm`：表单的 data-testid 与提交逻辑是 P1 的验收面，
 * 提示条只是叠在它上面的一行文本。
 */
export function LoginPage() {
  const location = useLocation()
  // router 的 state 是 unknown：只接受非空字符串，其他一律忽略
  const notice = readNotice(location.state)

  return (
    <>
      {notice ? (
        // pt 与 LoginForm 的 pt-16 对齐，保证提示条和标题在同一条视觉轴上
        <div className="mx-auto max-w-[24rem] px-6 pt-16">
          <p
            className="m-0 border-l-2 border-success pl-3 text-aux text-success"
            data-testid="login-notice"
          >
            {notice}
          </p>
        </div>
      ) : null}
      <LoginForm />
    </>
  )
}

function readNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as { notice?: unknown }).notice
  return typeof value === 'string' && value.length > 0 ? value : null
}
