import { Outlet, useMatch, useParams } from 'react-router'
import { CommunitySwitcher } from '@/features/community/community-switcher'
import { useCommunityDetail } from '@/features/community/api'
import { PostList } from '@/features/content/post-list'
import { cn } from '@/shared/lib/cn'

/**
 * 双栏布局：左边帖子列表，右边正文。
 *
 * 三条关键决定：
 *
 * 1. **URL 才是状态**。右栏内容由路由决定（index = 社群概览，
 *    p/:postId = 帖子正文），不用 useState。否则失去分享链接、后退键、
 *    刷新保持、cmd+click 开新标签。
 *
 * 2. **每栏各自滚动，页面本身不滚**。高度写成 `calc(100vh - 7rem)`：
 *    这 7rem 是 RootLayout 的 header + main 上下内边距的近似值。
 *    它是**估算**，不是布局系统算出来的——改头部高度时这里要跟着改。
 *    代价可以接受：算多了页面会多出一条细滚动条，算少了列表底部被切掉，
 *    两种都能一眼看出来。
 *
 * 3. **窄屏只显示一栏**：路由不变，按"当前是 index 还是详情"切换显示哪一栏。
 *    等上手机才发现要改，就得重做路由结构了。
 */
export function CommunityLayout() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const inDetail = Boolean(useMatch('/c/:name/p/:postId'))

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-border">
      <aside
        className={cn(
          'flex w-full shrink-0 flex-col overflow-y-auto border-border md:w-[320px] md:border-r',
          inDetail ? 'hidden md:flex' : 'flex',
        )}
        data-testid="left-pane"
      >
        <CommunitySwitcher activeName={detail.data?.name} />
        {/* key 用社群 id：切社群时整个列表重新挂载，分页状态自然归零 */}
        <PostList key={detail.data?.id ?? 'pending'} communityId={detail.data?.id} />
      </aside>

      <section
        className={cn(
          'flex-1 overflow-y-auto',
          inDetail ? 'block' : 'hidden md:block',
        )}
        data-testid="right-pane"
      >
        <Outlet />
      </section>
    </div>
  )
}
