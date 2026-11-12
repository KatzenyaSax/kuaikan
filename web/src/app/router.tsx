import type { RouteObject } from 'react-router'
import { createBrowserRouter } from 'react-router'
import { RootLayout } from '@/routes/root'
import { HomePage } from '@/routes/home'
import { CommunityPage } from '@/routes/community'
import { NewPostPage } from '@/routes/new-post'
import { PostPage } from '@/routes/post'
import { RegisterPage } from '@/routes/register'
import { TestPage } from '@/routes/test'
import { LoginPage } from '@/routes/login'
import { MePage } from '@/routes/me'
import { AuthBootstrap, RequireAuth } from '@/features/auth/auth-gate'
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
    // AuthBootstrap 在整个应用之外先跑一次静默续期：
    // httpOnly cookie 决定了前端无法同步判断登录态，必须先问服务端。
    element: (
      <AuthBootstrap>
        <RootLayout />
      </AuthBootstrap>
    ),
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      // 社群名本身就是标识（没有 slug），服务端按规范化后的名称查找
      { path: 'c/:name', element: <CommunityPage /> },
      // 发帖与帖子详情：帖子用 id 做 URL（标题会变、会重复，不适合进 URL）
      { path: 'c/:name/new', element: (
        <RequireAuth>
          <NewPostPage />
        </RequireAuth>
      ) },
      { path: 'c/:name/p/:postId', element: <PostPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'login', element: <LoginPage /> },
      {
        path: 'me',
        element: (
          <RequireAuth>
            <MePage />
          </RequireAuth>
        ),
      },
      { path: 'test', element: <TestPage /> },
      ...devOnlyRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
