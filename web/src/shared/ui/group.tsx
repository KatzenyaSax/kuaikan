import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

export function Group({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string | undefined
  description?: string | undefined
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || description || action) && (
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            {title && (
              <h2 className="font-display text-sm font-bold tracking-wide text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
