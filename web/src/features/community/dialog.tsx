import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/cn'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  testId,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  testId?: string | undefined
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            data-testid={testId}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn(
              'glass-panel-strong relative z-10 w-full max-w-lg overflow-hidden rounded-3xl shadow-2xl',
              className,
            )}
          >
            <div
              className="h-[2px] w-full"
              style={{ background: 'var(--accent-gradient)' }}
            />
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-glass)] px-6 py-4">
              <div>
                <h2 className="font-display text-base font-bold text-foreground">{title}</h2>
                {description && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭弹窗"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  pending = false,
  error,
  testId,
  confirmTestId,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  pending?: boolean
  error?: string | null | undefined
  testId?: string | undefined
  confirmTestId?: string | undefined
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} testId={testId}>
      <div className="space-y-5">
        <div className="text-sm leading-relaxed text-secondary-foreground">{description}</div>
        {error && (
          <p className="rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={pending}
            data-testid={confirmTestId}
          >
            {pending ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
