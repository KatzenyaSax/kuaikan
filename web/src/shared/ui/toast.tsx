import { useEffect, useState } from 'react'

type ToastItem = { id: number; text: string }

let seq = 0
const listeners = new Set<(items: ToastItem[]) => void>()
let items: ToastItem[] = []

function emit() {
  for (const fn of listeners) fn(items)
}

/**
 * 轻提示。模块级函数，任何地方都能调，不需要 context。
 *
 * 用它代替"页面上散落的红字"：错误提示、操作成功反馈都走这里，
 * 才能保证同一件事在全站长得一样、位置一样。
 */
export function toast(text: string, ms = 1800) {
  const id = (seq += 1)
  items = [...items, { id, text }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, ms)
}

/** 挂在应用根部一次即可 */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items)

  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed bottom-9 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="rounded-full bg-[rgba(10,10,10,0.88)] px-4.5 py-2.5 text-aux text-white backdrop-blur-[10px]"
          style={{
            boxShadow: 'var(--shadow-float)',
            animation: 'rise 250ms cubic-bezier(0.2,0.8,0.2,1) both',
          }}
          data-testid="toast"
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
