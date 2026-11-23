import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-aurora border border-white/20 font-semibold',
  secondary:
    'glass-panel text-foreground hover:border-[rgba(var(--accent-rgb),0.45)] hover:bg-[var(--bg-surface-hover)] font-medium',
  outline:
    'glass-panel text-foreground hover:border-[rgba(var(--accent-rgb),0.45)] hover:bg-[var(--bg-surface-hover)] font-medium',
  ghost:
    'bg-transparent text-secondary-foreground hover:bg-[var(--bg-surface-hover)] hover:text-foreground font-medium',
  danger:
    'border border-danger/35 bg-[var(--color-danger-soft)] text-danger hover:bg-danger hover:text-white font-medium shadow-sm',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-xl gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-sm rounded-2xl gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center whitespace-nowrap select-none transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-glow)] disabled:pointer-events-none disabled:opacity-45',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    />
  )
})
