import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

/*
 * ============================================================
 * inset grouped 列表 —— Apple 设置页/账户页的那种结构。
 *
 *   <GroupHeader>资料</GroupHeader>
 *   <Group>
 *     <GroupRow>昵称 …</GroupRow>
 *     <GroupRow>邮箱 …</GroupRow>
 *   </Group>
 *   <GroupFooter>邮箱不可修改</GroupFooter>
 *
 * 三条规矩：
 *   1. 分组是**浅底上的白色圆角块**，不用边框、不用阴影 —— 白面本身就够了。
 *      所以页面要把底色设成 `bg-surface`（#f5f5f7），否则分组看不见。
 *   2. 行与行之间是**内缩的 1px hairline**，不是通栏线：它更像列表，不像表格。
 *   3. 行高固定 48px（py-3 + 正文行高），触摸目标才够大。
 * ============================================================
 */

/** 白色圆角分组。子元素直接用 GroupRow / 任意内容。 */
export function Group({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('overflow-hidden rounded-[var(--radius-lg)] bg-card', className)}
      {...rest}
    />
  )
}

/** 分组上方的小标题（13px 灰字，内缩 16px 对齐行内容） */
export function GroupHeader({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-4 pb-2 text-aux font-normal text-muted-foreground', className)}
      {...rest}
    />
  )
}

/** 分组下方的一句说明 */
export function GroupFooter({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-4 pt-2 text-caption leading-[1.5] text-faint', className)}
      {...rest}
    />
  )
}

/**
 * 分组行样式。给需要自己当 `<li>`/`<tr>` 的场景复用（列表语义不能丢），
 * 与 GroupRow 渲染出来的类完全一致。
 */
export function groupRowClass({
  interactive = false,
  className,
}: { interactive?: boolean; className?: string } = {}): string {
  return cn(
    'relative flex min-h-12 items-center gap-3 px-4 py-3 text-body text-foreground',
    // 行间 hairline：左右各内缩 16px，最后一行不画
    'after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border after:content-[""] last:after:hidden',
    interactive && 'cursor-pointer transition-colors duration-[var(--duration-fast)] hover:bg-fill',
    className,
  )
}

/**
 * 一行。
 *
 * `interactive` 才给 hover 底色和手型 —— 一行的可点性必须看起来就可点，
 * 不可点的行不该在 hover 时亮起来（那会诱导点击）。
 */
export function GroupRow({
  className,
  interactive = false,
  ...rest
}: ComponentProps<'div'> & { interactive?: boolean }) {
  return <div className={groupRowClass({ interactive, ...(className === undefined ? {} : { className }) })} {...rest} />
}
