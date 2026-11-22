import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@/shared/ui/button'

/**
 * 渲染期异常的兜底。
 *
 * 两件事要同时做到：
 *   1. **不让用户看到白屏**，并且给一条明确的出路（回首页）
 *   2. **把错误原文留在页面上**：这条边界只有开发者和运维会看到它的细节，
 *      藏起来等于让"页面出错了"变成不可复现的一句话
 *
 * 版式用营销页语言（display 大标题 + 居中留白），因为这一刻用户什么都不该读，
 * 只需要知道"不是你的错"和"点哪里"。错误详情压在最下面，小字、等宽、可横向滚动。
 *
 * 注意：这条边界在 RootLayout **之外**（`errorElement`），所以没有顶栏和页脚，
 * 自己撑满 `min-h-screen`。
 */
export function RootErrorBoundary() {
  const error = useRouteError()

  const detail = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-20">
      <div className="mx-auto w-full max-w-[680px] text-center">
        <p className="m-0 text-caption font-semibold tracking-[0.18em] text-faint">出错了</p>
        <h1 className="m-0 mt-4 text-balance text-display">页面没能加载出来</h1>
        <p className="m-0 mx-auto mt-6 max-w-[26em] text-balance text-sub leading-[1.5] text-muted-foreground">
          这次渲染被错误边界接住了，所以你看到的是这一页，而不是白屏。回首页再试一次。
        </p>

        <div className="mt-10 flex items-center justify-center">
          <Button size="lg" onClick={() => window.location.assign('/')}>
            回到首页
          </Button>
        </div>

        {/* 详情给开发者看，不给用户读：小字、等宽、浅底，不抢标题的位置 */}
        <pre className="mx-auto mt-12 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--radius-md)] bg-surface px-4 py-3 text-left font-mono text-caption leading-[1.6] text-faint">
          {detail}
        </pre>
      </div>
    </div>
  )
}
