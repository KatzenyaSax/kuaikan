import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 空态。统一成"一句说明 + 一句补充 + 一个动作"。
 *
 * 散落各处的"这里什么都没有"是最容易暴露"没做完"的地方，所以它必须有统一的形状。
 * 不放插画、不放灰图标：这套视觉里排版就是视觉重量。
 */
export function Empty({
  title,
  description,
  action,
  className,
  testId,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div className={cn('px-6 py-16 text-center', className)} data-testid={testId}>
      <p className="m-0 mb-2 text-read font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mb-6 mt-0 max-w-[26rem] text-aux leading-[1.7] text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  )
}
