import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

const BASE_CONTROL =
  'w-full rounded-xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/75 transition-all duration-200 focus:border-[rgba(var(--accent-rgb),0.65)] focus:outline-none focus:ring-2 focus:ring-[var(--ring-glow)] disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(BASE_CONTROL, className)} {...rest} />
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(BASE_CONTROL, 'resize-y leading-relaxed', className)} {...rest} />
})

export function Field({
  label,
  hint,
  error,
  htmlFor,
  right,
  children,
  className,
}: {
  label: string
  hint?: string | undefined
  error?: string | undefined
  htmlFor?: string | undefined
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold tracking-wide text-secondary-foreground"
        >
          {label}
        </label>
        {right}
      </div>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
