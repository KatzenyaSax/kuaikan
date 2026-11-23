import type { RouteObject } from 'react-router'
import { createBrowserRouter } from 'react-router'
import { RootLayout } from '@/routes/root'
import { HomePage } from '@/routes/home'
import { FollowingPage } from '@/routes/following'
import { CommunityLanding } from '@/routes/community-landing'
import { HotPage } from '@/routes/hot'
import { SearchPage } from '@/routes/search'
import { CommunityLayout } from '@/features/community/community-layout'
import { CommunityOverview } from '@/features/community/community-overview'
import { CommunityHistoryPage } from '@/routes/community-history'
import { CommunityManagePage } from '@/routes/community-manage'
import { NewPostPage } from '@/routes/new-post'
import { PostPage } from '@/routes/post'
import { RegisterPage } from '@/routes/register'
import { TestPage } from '@/routes/test'
import { UserProfilePage } from '@/routes/user-profile'
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
      { path: 'following', element: <FollowingPage /> },
      { path: 'hot', element: <HotPage /> },
      // 全站搜索：**公开路由**（游客可读）。状态全部住在查询参数里（q / sort / communityId），
      // 刷新与分享都能还原；不套 RequireAuth —— 搜索是"把公开内容带出去"。
      { path: 'search', element: <SearchPage /> },
      // 社群入口：没带具体社群时由这个页面自己决定去哪
      { path: 'c', element: <CommunityLanding /> },
      // 社群名本身就是标识（没有 slug），服务端按规范化后的名称查找
      // 双栏布局：左列表 + 右正文。index 是社群概览（右栏空态）。
      { 
        path: 'c/:name',
        element: <CommunityLayout />,
        children: [
          { index: true, element: <CommunityOverview /> },
          { path: 'p/:postId', element: <PostPage /> },
        ],
      },
      { path: 'c/:name/new', element: (
        <RequireAuth>
          <NewPostPage />
        </RequireAuth>
      ) },
      // 社群历史：**公开**单栏页，不套双栏（历史是这个社群的档案，不是“读帖子”）。
      // 与 /c/:name 并列而不是它的子路由：子路由会继承双栏布局，
      // 而历史页需要整页 980px。
      { path: 'c/:name/history', element: <CommunityHistoryPage /> },
      // 管理台：需登录。非管理员由页面自己渲染「无权限」+ 返回链接——
      // 比直接 404 或跳走更诚实（他确实有权知道这个社群有管理台）。
      {
        path: 'c/:name/manage',
        element: (
          <RequireAuth>
            <CommunityManagePage />
          </RequireAuth>
        ),
      },
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
      // 用户主页（占位）。评论区里的 @某人 需要点得动
      { path: 'u/:userId', element: <UserProfilePage /> },
      { path: 'test', element: <TestPage /> },
      ...devOnlyRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
