import { useEffect, type ReactNode } from 'react'
import { Button } from '@/shared/ui/button'

/**
 * 居中弹窗。社群治理里所有的"确认"都走这一个壳。
 *
 * 与 `shared/ui/sheet.tsx`（底部弹窗）分工明确：
 *   - Sheet 用来**浏览一组东西**（社群切换器：大卡片列表，滑得动）
 *   - Modal 用来**做一个决定**（删帖、封禁、转让）：遮罩 + 居中卡片，
 *     两个按钮在右下角，视线不用从内容上离开
 *
 * 四件必须做到的事（与 Sheet 同一套标准）：遮罩点击关闭、ESC 关闭、
 * 打开时锁 body 滚动、面板挡住点击不穿透。
 *
 * 只在需要时挂载（调用方 `{cond ? <Modal/> : null}`），不做 `open` 动画态：
 * 一个"要做一个决定"的弹窗不该有 250ms 的滑入让人等。
 */
export function Modal({
  title,
  description,
  children,
  onClose,
  testId,
  footer,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  onClose: () => void
  testId?: string
  footer?: ReactNode
}) {
  useEffect(() => {
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
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.32)] p-4"
      onClick={onClose}
      data-testid={testId}
      style={{ animation: 'fade-in var(--duration-fast) var(--ease-out-soft) both' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-full max-w-[27rem] overflow-y-auto rounded-[var(--radius-xl)] bg-background p-7"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <h2 className="m-0 text-sub font-semibold">{title}</h2>
        {description ? (
          <div className="m-0 mt-2 text-aux leading-[1.7] text-muted-foreground">{description}</div>
        ) : null}
        {children ? <div className="mt-5">{children}</div> : null}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}

/**
 * 二次确认。管理员删帖/删评、转让管理员都要过这一道。
 *
 * 文案必须说清**后果**（"删除后…"），而不只是问"确定吗" ——
 * 一个只问"确定吗"的弹窗，用户点到第三次就不看了。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
  testId,
  confirmTestId,
}: {
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  testId?: string
  confirmTestId?: string
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onCancel}
      {...(testId === undefined ? {} : { testId })}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'bg-danger hover:bg-danger' : undefined}
            data-testid={confirmTestId}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    />
  )
}
