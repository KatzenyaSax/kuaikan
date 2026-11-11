import { useState } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 头像。有 URL 就显示图片，没有（或加载失败）就显示昵称首字。
 *
 * 客户端也做一次协议白名单：后端已经校验过 `^https?://`，但头像是直接塞进
 * `<img src>` 的，多一层检查成本为零。`javascript:` 对 img 不构成执行风险，
 * 但 `data:` URI 可以做超长内联、也可以当追踪像素，没必要放行。
 */
export function Avatar({
  url,
  name,
  size = 24,
  className,
}: {
  url: string | null
  name: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const safe = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null
  const showImage = safe !== null && !failed

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'border border-border bg-muted text-[11px] text-muted-foreground',
        className,
      )}
      style={{ width: size, height: size }}
      data-testid="avatar"
    >
      {showImage ? (
        <img
          src={safe}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          data-testid="avatar-image"
        />
      ) : (
        <span aria-hidden>{name.trim().charAt(0) || '?'}</span>
      )}
    </span>
  )
}
