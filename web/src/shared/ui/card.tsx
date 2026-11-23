import type { HTMLAttributes, PointerEvent } from 'react'
import { cn } from '@/shared/lib/cn'

function handleSpotlightMove(e: PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${String(e.clientX - rect.left)}px`)
  el.style.setProperty('--my', `${String(e.clientY - rect.top)}px`)
}

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** 是否开启鼠标追踪流光边框（默认开启） */
  spotlight?: boolean
  /** 更强的磨砂层级 */
  strong?: boolean
  /** 紧凑内边距 */
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({
  className,
  spotlight = true,
  strong = false,
  padding = 'md',
  onPointerMove,
  children,
  ...rest
}: CardProps) {
  const padClass =
    padding === 'none'
      ? ''
      : padding === 'sm'
        ? 'p-4'
        : padding === 'lg'
          ? 'p-6 sm:p-7'
          : 'p-5'

  return (
    <div
      onPointerMove={(e) => {
        if (spotlight) handleSpotlightMove(e)
        onPointerMove?.(e)
      }}
      className={cn(
        'rounded-2xl',
        spotlight ? 'spotlight-card' : strong ? 'glass-panel-strong' : 'glass-panel',
        padClass,
        className,
      )}
      {...rest}
    >
      <div className="relative z-[2]">{children}</div>
    </div>
  )
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-3 flex items-start justify-between gap-3', className)} {...rest} />
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-display text-base font-semibold tracking-tight text-foreground',
        className,
      )}
      {...rest}
    />
  )
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...rest} />
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-3', className)} {...rest} />
}
