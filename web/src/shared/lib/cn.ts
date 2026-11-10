import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 className。twMerge 负责解决 Tailwind 类冲突（如 px-2 与 px-4 并存时保留后者）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
