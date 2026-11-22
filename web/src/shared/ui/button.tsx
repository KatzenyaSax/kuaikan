import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

type Variant = 'primary' | 'outline' | 'ghost' | 'link' | 'inverse'
type Size = 'sm' | 'md' | 'lg'

/*
 * 全部按钮都是**胶囊**（Apple 的按钮形态），四级 + 一条深色带上的白色胶囊：
 *   primary  实心蓝 —— 全站唯一"值得蓝"的主操作（发表、创建、注册）
 *   outline  次级灰底 —— 与 primary 并排的第二个动作（取消、次要入口）
 *   ghost    纯文字 —— 第三级，hover 才出现淡底
 *   link     文字链 —— 营销页的"先逛逛 ›"这类，纯蓝字不带底
 *   inverse  白色胶囊 —— 只用在深色带上（#000 / #1d1d1f）
 *
 * 蓝色仍然只用于交互态：它现在是主按钮的颜色，因为主按钮本身就是交互态。
 * 其余地方（标题、图标、装饰）一律中性色。
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover active:scale-[0.98]',
  outline: 'bg-fill text-foreground hover:bg-fill-strong active:scale-[0.98]',
  ghost: 'text-muted-foreground hover:bg-fill hover:text-foreground',
  link: 'text-primary hover:text-primary-hover hover:underline underline-offset-[3px]',
  inverse: 'bg-background text-foreground hover:opacity-90 active:scale-[0.98]',
}

/* 高度按 Apple 的 32/40/44 三档：窄屏点得着，桌面不臃肿 */
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-aux',
  md: 'h-10 px-4.5 text-aux',
  lg: 'h-11 px-6 text-body',
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
    'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-full font-medium',
    'transition-[background-color,color,opacity,transform] duration-[var(--duration-fast)]',
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
