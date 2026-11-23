import type { HTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

export type PillTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'aurora'

const TONE_MAP: Record<PillTone, string> = {
  default: 'border-[var(--border-glass-strong)] bg-[var(--bg-surface)] text-secondary-foreground',
  primary: 'border-[rgba(var(--accent-rgb),0.32)] bg-[var(--color-primary-soft)] text-primary',
  success: 'border-success/30 bg-[var(--color-success-soft)] text-success',
  warning: 'border-warning/35 bg-[var(--color-warning-soft)] text-warning',
  danger: 'border-danger/35 bg-[var(--color-danger-soft)] text-danger',
  aurora: 'border-white/25 text-white shadow-sm',
}

export function Pill({
  tone = 'default',
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight',
        TONE_MAP[tone],
        className,
      )}
      style={
        tone === 'aurora'
          ? {
              background: 'var(--accent-gradient)',
              color: 'var(--btn-fg, #ffffff)',
              ...style,
            }
          : style
      }
      {...rest}
    />
  )
}
