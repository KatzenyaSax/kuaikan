import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/** 骨架屏。缓慢脉冲，不要用 Tailwind 默认的 animate-pulse（它太"闪"） */
export function Skeleton({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-[var(--radius-sm)] bg-[rgba(0,0,0,0.07)]', className)}
      style={{ animation: 'soft-pulse 1.6s cubic-bezier(0.2,0.8,0.2,1) infinite' }}
      {...rest}
    />
  )
}
