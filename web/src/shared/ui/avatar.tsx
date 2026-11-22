import { useState } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 头像。有 URL 就显示图片，没有（或加载失败）就显示昵称首字。
 *
 * 没有头像时**不用灰底**，用一层柔和的渐变 + 首字：满屏灰圆点会让
 * 列表看起来没做完，而渐变能形成色块节奏（这是"没有素材也要有视觉重量"的办法）。
 *
 * 渐变外面加一圈 0.5px 的内描边：纯色块在白底上边缘会发虚，
 * 一条几乎看不见的线就能把它"钉"住（Apple 的头像和图标都这么处理）。
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
  // noUncheckedIndexedAccess：下标访问返回可能 undefined，给一个兜底
  const [from, to] = GRADIENTS[seed % GRADIENTS.length] ?? GRADIENTS[0]!

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none',
        // 内描边：给色块一个确定的边界，不改变尺寸
        'shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.10)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: showImage ? undefined : `linear-gradient(140deg, ${from}, ${to})`,
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

/* 取色偏灰蓝、饱和度收一点：满屏高饱和色块会盖过正文，这组能形成节奏又不吵 */
const GRADIENTS: Array<[string, string]> = [
  ['#6b7280', '#3a4048'],
  ['#3d8bfd', '#1c5bb8'],
  ['#34a06a', '#1d6b45'],
  ['#c8794a', '#91491f'],
  ['#b4518f', '#7a2a63'],
  ['#8a6cf0', '#5136c4'],
  ['#d0a43a', '#96700f'],
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
