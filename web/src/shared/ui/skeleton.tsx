import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

export function Skeleton({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} {...rest} />
}
