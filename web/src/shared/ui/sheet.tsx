import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  headerAction,
  side = 'right',
  children,
  testId,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  headerAction?: ReactNode
  side?: 'right' | 'left' | 'bottom'
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

  const initialPos =
    side === 'right'
      ? { x: '100%' }
      : side === 'left'
        ? { x: '-100%' }
        : { y: '100%' }

  const positionClass =
    side === 'right'
      ? 'inset-y-0 right-0 h-full w-full max-w-[440px] rounded-l-3xl border-l'
      : side === 'left'
        ? 'inset-y-0 left-0 h-full w-full max-w-[360px] rounded-r-3xl border-r'
        : 'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-3xl border-t'

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            data-testid={testId}
            initial={initialPos}
            animate={{ x: 0, y: 0 }}
            exit={initialPos}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className={cn(
              'glass-panel-strong fixed z-10 flex flex-col overflow-hidden',
              positionClass,
              className,
            )}
          >
            {(title || headerAction) && (
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-glass)] px-5 py-4">
                <div className="min-w-0">
                  {title && (
                    <div className="font-display text-base font-bold tracking-tight text-foreground">
                      {title}
                    </div>
                  )}
                  {subtitle && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {headerAction}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭"
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
