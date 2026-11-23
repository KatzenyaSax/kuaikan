import { useId } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  badge?: number | string | undefined
  testId?: string | undefined
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (next: T) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  const groupId = useId()

  return (
    <div
      role="tablist"
      className={cn(
        'glass-panel inline-flex items-center gap-1 rounded-2xl p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl font-medium transition-colors select-none',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-1.5 text-sm',
              active ? '' : 'text-muted-foreground hover:text-foreground',
            )}
            style={active ? { color: 'var(--btn-fg, #ffffff)' } : undefined}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-xl shadow-md"
                style={{
                  background: 'var(--accent-gradient)',
                  boxShadow: '0 6px 18px -4px rgba(var(--accent-rgb), 0.55)',
                }}
              />
            )}
            <span>{o.label}</span>
            {o.badge !== undefined && Number(o.badge) > 0 && (
              <span
                className={cn(
                  'tabular-nums rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                  active
                    ? 'bg-white/25 text-white'
                    : 'bg-[var(--color-primary-soft)] text-primary',
                )}
              >
                {o.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
