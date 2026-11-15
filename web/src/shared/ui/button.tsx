import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

type Variant = 'primary' | 'outline' | 'ghost'
type Size = 'sm' | 'md'

/*
 * 三级按钮。规则：
 *   primary  近黑药丸 —— 全站每屏最多一个（"发表""创建"这类主操作）
 *   outline  hairline 描边 —— 次要操作
 *   ghost    纯文字 —— 第三级，hover 才出现底色
 *
 * 不用蓝色做主按钮：蓝色只用于交互态（链接、已赞），
 * 否则满屏蓝色会和"克制"背道而驰。
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-foreground text-white hover:opacity-85 active:scale-[0.98]',
  outline: 'border border-border-strong text-foreground hover:bg-surface',
  ghost: 'text-muted-foreground hover:text-foreground hover:bg-surface',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-aux',
  md: 'h-9 px-4 text-aux',
}

export type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant
  size?: Size
}

/**
 * 生成按钮样式。给「需要渲染成 <a> 的元素」复用，避免 <a> 嵌套在 <button> 里
 * （那是非法 HTML，可访问性与默认行为都会出问题）。
 */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: Variant
  size?: Size
  className?: string
} = {}): string {
  return cn(
    'inline-flex select-none items-center justify-center gap-1.5 rounded-full font-medium',
    'transition-[opacity,transform,background-color,color] duration-[150ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
    'disabled:pointer-events-none disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, ...(className === undefined ? {} : { className }) })}
      {...rest}
    />
  )
}
