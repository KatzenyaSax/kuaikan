import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 空态。统一成"一句说明 + 一个动作"。
 *
 * 散落各处的"这里什么都没有"是最容易暴露"没做完"的地方，
 * 所以它必须有统一的形状。
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
      <p className="mb-2 text-body font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mb-5 max-w-md text-aux text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
