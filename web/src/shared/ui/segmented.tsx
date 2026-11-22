import { cn } from '@/shared/lib/cn'

/**
 * 分段控件：日榜 / 周榜 这类"互斥的少量选项"。
 *
 * 形态取 Apple 的 segmented control：一条淡灰轨道（fill），选中的那格是
 * **白色浮起块** —— 靠"白 + 一点点阴影"表达选中，而不是靠蓝色填充。
 * 蓝色留给真正的动作。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  /** `testId` 是可选的：e2e 依赖的那几个 Tab 需要它，新写的可以不给 */
  options: Array<{ value: T; label: string; testId?: string }>
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      className={cn('inline-flex rounded-full bg-fill p-[3px]', className)}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          data-testid={o.testId}
          className={cn(
            'h-7 rounded-full px-4 text-aux transition-[background-color,color,box-shadow] duration-[var(--duration-fast)]',
            o.value === value
              ? 'bg-background font-medium text-foreground shadow-[var(--shadow-soft)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
