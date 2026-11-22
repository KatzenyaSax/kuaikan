import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 骨架屏。缓慢脉冲，不要用 Tailwind 默认的 animate-pulse（它太"闪"）。
 *
 * 底色用 fill（5% 黑）而不是灰块：它要能在白底和 #f5f5f7 底上都成立。
 * 圆角跟着位置走，默认 sm —— 传 rounded-full 就能变成头像占位。
 */
export function Skeleton({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-[var(--radius-sm)] bg-fill', className)}
      style={{ animation: 'soft-pulse 1.6s var(--ease-out-soft) infinite' }}
      {...rest}
    />
  )
}
