import { cn } from '@/shared/lib/cn'

/**
 * 1px 分隔线。这套视觉的主要分区手段（分组卡片里用 Group 自带的行间 hairline）。
 *
 * `inset` 让线从内容起始处开始而不是贴边 —— Apple 的列表就是这种"内缩线"，
 * 它比通栏线更像列表而不像表格。
 */
export function Divider({ className, inset = false }: { className?: string; inset?: boolean }) {
  return (
    <div
      className={cn('h-px bg-border', inset && 'ml-4', className)}
      role="separator"
    />
  )
}
