import { useState } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 头像。有 URL 就显示图片，没有（或加载失败）就显示昵称首字。
 *
 * 没有头像时**不用灰底**，用一层柔和的渐变 + 首字：满屏灰圆点会让
 * 列表看起来没做完，而渐变能形成色块节奏（这是"没有素材也要有视觉重量"的办法）。
 *
 * 客户端也做一次协议白名单：后端已校验 `^https?://`，但头像是直接塞进 `<img src>` 的，
 * 多一层检查成本为零。`data:` URI 可以当追踪像素、可以超长内联，没必要放行。
 */
export function Avatar({
  url,
  name,
  size = 24,
  className,
  tone,
}: {
  url: string | null
  name: string
  size?: number
  className?: string
  /** 决定渐变配色。不传则按昵称散列，保证同一个人颜色稳定 */
  tone?: number
}) {
  const [failed, setFailed] = useState(false)
  const safe = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null
  const showImage = safe !== null && !failed
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  const seed = tone ?? hash(name)
  const [from, to] = GRADIENTS[seed % GRADIENTS.length]

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: showImage ? undefined : `linear-gradient(135deg, ${from}, ${to})`,
      }}
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
        <span aria-hidden>{initial}</span>
      )}
    </span>
  )
}

const GRADIENTS: Array<[string, string]> = [
  ['#5b6472', '#2b3138'],
  ['#2f7fe0', '#1a4fa0'],
  ['#2f9e63', '#1d6b42'],
  ['#c2703a', '#8a4418'],
  ['#b03b8e', '#6d1f58'],
  ['#7c5cff', '#4b2fd6'],
  ['#d4a02c', '#8f6612'],
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
