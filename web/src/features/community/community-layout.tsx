import { Outlet, useMatch, useParams } from 'react-router'
import { CommunitySwitcher } from '@/features/community/community-switcher'
import { useCommunityDetail } from '@/features/community/api'
import { PostList } from '@/features/content/post-list'
import { Divider } from '@/shared/ui/divider'
import { cn } from '@/shared/lib/cn'

/**
 * 双栏布局：左边帖子列表，右边正文。
 *
 * 四条关键决定：
 *
 * 1. **容器 1200px 居中**。不居中的话，1280 视口下左栏贴左、右栏内容被推到很右，
 *    两栏之间空一大块，看起来像两个不相干的页面。
 *
 * 2. **URL 才是状态**。右栏内容由路由决定（index = 社群概览，p/:postId = 帖子正文），
 *    不用 useState。否则失去分享链接、后退键、刷新保持、cmd+click 开新标签。
 *
 * 3. **每栏各自滚动，页面本身不滚**。高度 = 视口 − 顶栏，用 `var(--topbar-h)`
 *    而不是写死的数字：顶栏高度改了这里自动跟上。
 *    （这条路由不显示页脚——双栏阅读页不需要页脚，见 RootLayout。）
 *
 * 4. **窄屏只显示一栏**：路由不变，按"当前是 index 还是详情"切换显示哪一栏。
 */
export function CommunityLayout() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const inDetail = Boolean(useMatch('/c/:name/p/:postId'))

  return (
    <div className="mx-auto flex h-[calc(100vh-var(--topbar-h))] w-full max-w-[1200px] overflow-hidden">
      <aside
        className={cn(
          'w-full shrink-0 overflow-y-auto border-border md:w-[300px] md:border-r',
          inDetail ? 'hidden md:block' : 'block',
        )}
        data-testid="left-pane"
      >
        {/* 分组小标题不是装饰：它把"我在哪一层"说清楚。没有它，左栏就是
            "一个下拉框 + 一堆文字"，结构感全无。 */}
        <div className="px-4 pb-3 pt-4">
          <p className="m-0 mb-2 text-caption font-semibold uppercase tracking-[0.06em] text-faint">
            选择社群
          </p>
          <CommunitySwitcher activeName={detail.data?.name} />
        </div>

        <Divider className="mx-4" />

        <div className="px-2 pb-8 pt-3">
          <p className="m-0 mb-1 px-2 text-caption font-semibold uppercase tracking-[0.06em] text-faint">
            帖子
          </p>
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
