import { cn } from '@/shared/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-xl', className)} />
}
