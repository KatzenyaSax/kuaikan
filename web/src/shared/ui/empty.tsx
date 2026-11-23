import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export function Empty({
  title,
  description,
  icon,
  action,
  className,
  testId,
}: {
  title: string
  description?: string | undefined
  icon?: ReactNode
  action?: ReactNode
  className?: string
  testId?: string | undefined
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'glass-panel flex flex-col items-center justify-center rounded-3xl px-6 py-12 text-center',
        className,
      )}
    >
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg"
        style={{
          background: 'linear-gradient(135deg, var(--aurora-1), var(--aurora-2))',
          boxShadow: '0 10px 28px -8px rgba(var(--accent-rgb), 0.55)',
        }}
      >
        {icon ?? <Sparkles className="h-5 w-5" />}
      </div>
      <p className="font-display text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
