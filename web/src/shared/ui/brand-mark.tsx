import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * kuaikan 棱镜极光品牌徽标（定制多面体流光 SVG）。
 */
export function BrandMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-xl',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* 外层环境辉光 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-xl opacity-65 blur-[8px]"
        style={{ background: 'var(--accent-gradient)' }}
      />
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative drop-shadow-sm"
      >
        <defs>
          <linearGradient id="kk-prism-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--aurora-1)" />
            <stop offset="52%" stopColor="var(--aurora-2)" />
            <stop offset="100%" stopColor="var(--aurora-3)" />
          </linearGradient>
          <linearGradient id="kk-prism-sheen" x1="8" y1="6" x2="32" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--btn-fg, #FFFFFF)" stopOpacity="0.96" />
            <stop offset="100%" stopColor="var(--btn-fg, #FFFFFF)" stopOpacity="0.65" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#kk-prism-bg)" />
        <rect
          x="1.5"
          y="1.5"
          width="37"
          height="37"
          rx="10.5"
          stroke="rgba(255,255,255,0.42)"
          strokeWidth="1"
        />
        {/* 棱镜 K 字几何折光 */}
        <path
          d="M12.5 11.5V28.5M12.5 20.5L23.5 11.5M17.5 16.8L26.5 28.5"
          stroke="url(#kk-prism-sheen)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="27.5" cy="12" r="2.3" fill="var(--btn-fg, #FFFFFF)" fillOpacity="0.92" />
      </svg>
    </div>
  )
}

/**
 * 双色微发光琉璃图标容器：给 lucide 图标穿上统一的高级琉璃光晕外壳。
 */
export function LuminousIcon({
  children,
  gradient,
  size = 'md',
  className,
}: {
  children: ReactNode
  gradient?: string | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dims =
    size === 'sm'
      ? 'h-8 w-8 rounded-lg'
      : size === 'lg'
        ? 'h-12 w-12 rounded-2xl'
        : 'h-10 w-10 rounded-xl'

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center shadow-md',
        dims,
        className,
      )}
      style={{
        background: gradient ?? 'var(--accent-gradient)',
        color: gradient ? '#ffffff' : 'var(--btn-fg, #ffffff)',
        boxShadow: '0 8px 20px -6px rgba(var(--accent-rgb), 0.55), inset 0 1px 0 rgba(255,255,255,0.38)',
      }}
    >
      {children}
    </span>
  )
}
