import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { getCommunityChroma } from '@/shared/theme/community-chroma'

export type AvatarProps = {
  name: string
  src?: string | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** 社群头像使用圆角方形，用户头像使用圆形 */
  shape?: 'circle' | 'rounded'
  /** 带极光流光外环 */
  ring?: boolean
  className?: string
  testId?: string
}

const SIZE_MAP: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-6 w-6 text-[11px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  ring = false,
  className,
  testId,
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const cleanSrc = src?.trim() || null
  const showImg = Boolean(cleanSrc && failedSrc !== cleanSrc)
  const chroma = getCommunityChroma(name)
  const initial = (name.trim().charAt(0) || '?').toUpperCase()
  const radius = shape === 'rounded' ? 'rounded-2xl' : 'rounded-full'

  return (
    <span
      data-testid={testId ?? 'avatar'}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-display font-bold text-white select-none',
        SIZE_MAP[size],
        radius,
        ring && 'ring-2 ring-[rgba(var(--accent-rgb),0.55)] ring-offset-2 ring-offset-[var(--bg-canvas)]',
        className,
      )}
      style={
        showImg
          ? undefined
          : {
              background: chroma.gradient,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.38)',
            }
      }
    >
      {showImg && cleanSrc ? (
        <img
          src={cleanSrc}
          alt={name}
          data-testid="avatar-image"
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(cleanSrc)}
        />
      ) : (
        <span className="drop-shadow-sm">{initial}</span>
      )}
    </span>
  )
}
