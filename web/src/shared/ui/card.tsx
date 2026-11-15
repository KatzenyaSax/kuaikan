import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 容器。
 *
 * **尽量别用。** 这套视觉里"分区"靠 1px hairline 和留白，不靠边框卡片——
 * 满屏卡片会立刻显得廉价。只有"表单/弹窗/需要独立边界"这类真正成块的东西才用它。
 */
export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-[var(--radius-lg)] border border-border bg-card p-4', className)}
      {...rest}
    />
  )
}

export function CardTitle({ className, ...rest }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-body font-semibold', className)} {...rest} />
}

export function CardDescription({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cn('text-aux text-muted-foreground', className)} {...rest} />
}
