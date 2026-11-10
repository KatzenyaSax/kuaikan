import type { RouteObject } from 'react-router'
import { createBrowserRouter } from 'react-router'
import { RootLayout } from '@/routes/root'
import { HomePage } from '@/routes/home'
import { RegisterPage } from '@/routes/register'
import { TestPage } from '@/routes/test'
import { NotFoundPage } from '@/routes/not-found'
import { RootErrorBoundary } from '@/routes/root-error'
import { ErrorDemoPage } from '@/routes/error-demo'

/**
 * Dev-only 路由：用来随时验证 ErrorBoundary 真的能兜住渲染期异常。
 *
 * import.meta.env.DEV 在构建时被替换为 false，整个分支会被 Rollup 摇掉，
 * 因此 __error-demo 不应出现在生产产物里（由 P0.5 的 L1 断言检查）。
 * 这样就不需要"临时加个路由试完再删"这种不可复现的验证方式。
 */
const devOnlyRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: '__error-demo', element: <ErrorDemoPage /> }]
  : []

const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'test', element: <TestPage /> },
      ...devOnlyRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
