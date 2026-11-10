/**
 * 刻意的渲染期异常，仅用于验证 ErrorBoundary。
 * 只通过 dev-only 路由 /__error-demo 可达，生产构建中被摇掉。
 */
export function ErrorDemoPage(): never {
  throw new Error('__error-demo：这是一个刻意的渲染期异常，用于验证 ErrorBoundary')
}
