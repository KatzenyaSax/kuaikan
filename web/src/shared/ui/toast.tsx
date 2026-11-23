import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export type ToastTone = 'info' | 'success' | 'danger'

export function Toast({
  message,
  tone = 'info',
  onClose,
  testId,
  className,
}: {
  message: string | null | undefined
  tone?: ToastTone
  onClose?: () => void
  testId?: string | undefined
  className?: string
}) {
  const Icon = tone === 'danger' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-[var(--color-danger-soft)] text-danger'
      : tone === 'success'
        ? 'border-success/40 bg-[var(--color-success-soft)] text-success'
        : 'border-[rgba(var(--accent-rgb),0.4)] bg-[var(--color-primary-soft)] text-foreground'

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role={tone === 'danger' ? 'alert' : 'status'}
          data-testid={testId ?? (tone === 'danger' ? 'toast-error' : 'toast')}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium backdrop-blur-xl',
            toneClass,
            className,
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 leading-snug">{message}</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭提示"
              className="cursor-pointer rounded-lg p-1 opacity-75 transition-opacity hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
