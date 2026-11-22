import { Link } from 'react-router'
import { buttonClass } from '@/shared/ui/button'

/**
 * 404。
 *
 * 用的是**营销页语言**而不是产品页语言：这里没有任何「信息」要给，
 * 只有一句话和一条出路。所以给它巨大留白、display 档大标题、一个胶囊按钮，
 * 而不是一张写着「页面不存在」的小卡片——卡片会让它看起来像功能的一部分。
 *
 * 文案不解释路由：读者不关心是「前端路由没匹配」还是「后端 404」，
 * 只关心下一步该点哪里。
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[calc(100vh-var(--topbar-h)-6rem)] items-center justify-center px-6 py-20">
      <div className="mx-auto w-full max-w-[680px] text-center">
        <p className="hero-in m-0 text-caption font-semibold tracking-[0.18em] text-faint">404</p>
        <h1
          className="hero-in m-0 mt-4 text-balance text-display"
          style={{ '--hero-delay': '80ms' } as React.CSSProperties}
        >
          这个地址没有页面
        </h1>
        <p
          className="hero-in m-0 mx-auto mt-6 max-w-[26em] text-balance text-sub leading-[1.5] text-muted-foreground"
          style={{ '--hero-delay': '160ms' } as React.CSSProperties}
        >
          链接可能拼错了，或者内容已经不在了。回到首页重新找一条路。
        </p>
        <div
          className="hero-in mt-10 flex items-center justify-center"
          style={{ '--hero-delay': '240ms' } as React.CSSProperties}
        >
          <Link to="/" className={buttonClass({ size: 'lg' })}>
            回到首页
          </Link>
        </div>
      </div>
    </div>
  )
}
