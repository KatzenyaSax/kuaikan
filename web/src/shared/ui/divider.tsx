import { cn } from '@/shared/lib/cn'

export function Divider({ className }: { className?: string }) {
  return (
    <hr
      className={cn('my-4 h-px border-0', className)}
      style={{
        background:
          'linear-gradient(90deg, transparent, var(--border-glass-strong) 18%, var(--border-glass-strong) 82%, transparent)',
      }}
    />
  )
}
