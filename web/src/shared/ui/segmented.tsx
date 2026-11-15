import { cn } from '@/shared/lib/cn'

/** 分段控件：日榜 / 周榜 这类"互斥的少量选项" */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex rounded-full bg-surface p-[3px]', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-full px-4 text-aux transition-colors duration-[150ms]',
            o.value === value
              ? 'bg-background font-semibold text-foreground shadow-[var(--shadow-soft)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
