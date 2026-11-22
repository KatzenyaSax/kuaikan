import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/*
 * 输入框的统一外观。
 *
 * 形态取 Apple 的表单：**淡灰填充 + 无边框**，聚焦时底色变白、加一圈
 * 3px 的浅蓝光晕。不用粗 ring 描边：粗 ring 会把布局撑开、也会在密集表单里显得吵。
 *
 * 填充色选 surface 而不是 fill：白底页面（登录、发帖）上 fill（5% 黑）太淡，
 * 看不出这里可以打字；而白底分组卡片里的输入框本来就少见。
 */
const FIELD =
  'w-full rounded-[var(--radius-md)] border border-transparent bg-surface px-3.5 text-body text-foreground placeholder:text-faint ' +
  'transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)] ' +
  'hover:bg-surface-strong ' +
  'focus:border-primary focus:bg-background focus:outline-none focus:shadow-[0_0_0_3px_var(--color-primary-soft)]'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, 'h-10', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'resize-y py-3 leading-[1.7]', className)} {...rest} />
}
