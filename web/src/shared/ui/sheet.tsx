import { useEffect, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * 底部弹窗（bottom sheet）。
 *
 * 为什么是"从底部弹出"而不是下拉菜单：这里要展示的是**一组带信息的卡片**
 * （头像、名字、成员数），下拉菜单只能放一行文字。社群多的时候下拉要滑很久、
 * 还容易误触；大卡片一眼就能扫完。
 *
 * 四个必须做到的点：
 *   1. 遮罩点击关闭、ESC 关闭（否则键盘用户被困住）
 *   2. 打开时锁住 body 滚动（否则背景会跟着滚，移动端尤其明显）
 *   3. 顶部大圆角 + 抓手条，让"可以下拉关闭"这件事有视觉钩子
 *   4. 面板是**半透明白 + 毛玻璃**：底下的内容隐约可见，弹层与页面才像是叠在一起的
 *
 * 桌面端限宽居中：铺满 1280px 会变成一条"横幅"，看起来像横幅而不是卡片。
 */
export function Sheet({
  open,
  onClose,
  title,
  meta,
  children,
  testId,
}: {
  open: boolean
  onClose: () => void
  title: string
  meta?: ReactNode
  children: ReactNode
  testId?: string
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-50 bg-[rgba(0,0,0,0.32)] transition-opacity duration-[var(--duration-base)]',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={cn(
          'fixed bottom-0 left-1/2 z-[55] flex max-h-[72vh] w-full max-w-[40rem] -translate-x-1/2 flex-col',
          'rounded-t-[var(--radius-xl)] bg-[rgba(255,255,255,0.86)] backdrop-blur-[30px] backdrop-saturate-[180%]',
          'pb-[calc(20px+env(safe-area-inset-bottom,0px))]',
          'transition-transform duration-[var(--duration-base)]',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="mx-auto mb-2 mt-2 h-1 w-9 shrink-0 rounded-full bg-fill-strong" />
        <div className="flex shrink-0 items-baseline justify-between border-b border-border px-6 pb-3">
          <h2 className="m-0 text-sub font-semibold">{title}</h2>
          {meta ? <span className="text-aux text-faint">{meta}</span> : null}
        </div>
        <div className="overflow-y-auto px-6 pb-2 pt-4">{children}</div>
      </div>
    </>
  )
}
