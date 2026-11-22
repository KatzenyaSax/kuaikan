import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 小标签：社群名、分类。信息密度高但不抢视线。
 *
 * 淡灰胶囊，不用边框 —— 边框在密集列表里会形成一排竖线，比灰底吵得多。
 */
export function Pill({ className, ...rest }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center rounded-full bg-fill px-2.5 text-caption font-medium text-muted-foreground',
        className,
      )}
      {...rest}
    />
  )
}
