import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/*
 * 输入框的统一外观。
 *
 * focus 时**边框变强调色 + 1px 内阴影**，不用粗 ring：
 * 粗 ring 会把布局撑开、也会在密集表单里显得吵。
 */
const FIELD =
  'w-full rounded-[var(--radius-md)] border border-border-strong bg-background px-3.5 text-body text-foreground placeholder:text-faint ' +
  'transition-[border-color,box-shadow] duration-[150ms] ' +
  'focus:outline-none focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--color-primary)]'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, 'h-9', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'resize-y py-3 leading-[1.7]', className)} {...rest} />
}
