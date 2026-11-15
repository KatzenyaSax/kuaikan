import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/** 小标签：社群名、分类。信息密度高但不抢视线。 */
export function Pill({ className, ...rest }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-full bg-surface px-2.5 text-caption font-medium text-muted-foreground',
        className,
      )}
      {...rest}
    />
  )
}
