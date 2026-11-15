import { cn } from '@/shared/lib/cn'

/** 1px 分隔线。这套视觉的主要分区手段。 */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-border', className)} role="separator" />
}
