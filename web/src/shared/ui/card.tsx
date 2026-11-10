import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-4', className)}
      {...rest}
    />
  )
}

export function CardTitle({ className, ...rest }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm font-semibold tracking-wide', className)} {...rest} />
}

export function CardDescription({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...rest} />
}
