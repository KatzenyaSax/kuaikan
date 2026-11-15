import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 我们在 `@theme` 里自定义的字号档位（`--text-*`）。
 *
 * **必须告诉 twMerge 它们是字号**，否则它会把这些 `text-*` 归到颜色组里：
 * 于是 `text-white`（颜色）与 `text-aux`（字号）被当成冲突，后者胜出，
 * 白色文字被静默删除 —— 表现为"黑底黑字"。
 *
 * 这个坑第一次出现是 primary 按钮：`bg-foreground text-white` 后面跟着
 * `text-aux`，结果按钮上的字完全看不见，而 typecheck / lint / build 全绿。
 */
const FONT_SIZES = ['caption', 'aux', 'body', 'read', 'sub', 'title', 'display']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
    },
  },
})

/**
 * 合并 className。twMerge 负责解决 Tailwind 类冲突（如 px-2 与 px-4 并存时保留后者）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
