import { Outlet, useMatch, useParams } from 'react-router'
import { CommunitySwitcher } from '@/features/community/community-switcher'
import { useCommunityDetail } from '@/features/community/api'
import { PostList } from '@/features/content/post-list'
import { GroupHeader } from '@/shared/ui/group'
import { cn } from '@/shared/lib/cn'

/**
 * 双栏布局：左边帖子列表，右边正文。
 *
 * 四条关键决定：
 *
 * 1. **容器跟顶栏同一个 980px、同一份 px-6**。左栏的左边就是顶栏 logo 的左边，
 *    右栏的右边就是顶栏右端的右边——页面和内壳是一个宽度，不是两个。
 *    （顶栏是 980，这里如果还用 1200，两栏之间的留白会被拉成一条空带。）
 *
 * 2. **URL 才是状态**。右栏内容由路由决定（index = 社群概览，p/:postId = 帖子正文），
 *    不用 useState。否则失去分享链接、后退键、刷新保持、cmd+click 开新标签。
 *
 * 3. **每栏各自滚动，页面本身不滚**。高度 = 视口 − 顶栏，用 `var(--topbar-h)`
 *    而不是写死的数字：顶栏高度改了这里自动跟上。
 *    （这条路由不显示页脚——双栏阅读页不需要页脚，见 RootLayout。）
 *
 * 4. **窄屏只显示一栏**：路由不变，按"当前是 index 还是详情"切换显示哪一栏。
 *
 * 左栏是浅底（#f5f5f7）+ 白色分组：inset grouped 需要底色衬托，否则白分组看不见。
 */
export function CommunityLayout() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const inDetail = Boolean(useMatch('/c/:name/p/:postId'))

  return (
    <div className="mx-auto flex h-[calc(100vh-var(--topbar-h))] w-full max-w-[980px] px-0 md:px-6">
      <aside
        className={cn(
          'w-full shrink-0 overflow-y-auto bg-surface md:w-[272px]',
          inDetail ? 'hidden md:block' : 'block',
        )}
        data-testid="left-pane"
      >
        <div className="px-3 pb-10 pt-5">
          <GroupHeader className="px-1 pb-2.5">选择社群</GroupHeader>
          <CommunitySwitcher activeName={detail.data?.name} />

          <GroupHeader className="px-1 pb-2.5 pt-7">帖子</GroupHeader>
          {/* key 用社群 id：切社群时整个列表重新挂载，分页状态自然归零 */}
          <PostList key={detail.data?.id ?? 'pending'} communityId={detail.data?.id} />
        </div>
      </aside>

      <section
        className={cn('flex-1 overflow-y-auto', inDetail ? 'block' : 'hidden md:block')}
        data-testid="right-pane"
      >
        <Outlet />
      </section>
    </div>
  )
}
