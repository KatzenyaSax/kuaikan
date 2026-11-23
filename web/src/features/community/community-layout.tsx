import { Link, Outlet, useParams } from 'react-router'
import { ArrowLeft, PenLine } from 'lucide-react'
import { useCommunityDetail } from '@/features/community/api'
import { CommunitySwitcher } from '@/features/community/community-switcher'
import { PostList } from '@/features/content/post-list'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Card } from '@/shared/ui/card'
import { cn } from '@/shared/lib/cn'

/**
 * 社群双栏琉璃工作台：
 * - 桌面端：左栏（社群标识 + 帖子时间线）+ 右栏（社群概览或帖子沉浸阅读）
 * - 移动端：阅读帖子时收敛为单栏沉浸态，顶部提供返回帖子列表入口
 */
export function CommunityLayout() {
  const { name, postId } = useParams()
  const communityName = name ?? ''
  const detail = useCommunityDetail(communityName)
  const chroma = getCommunityChroma(communityName)
  const viewingPost = Boolean(postId)

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* 左栏：社群头 + 帖子列表 */}
      <aside
        data-testid="left-pane"
        className={cn(
          'lg:col-span-4 xl:col-span-4',
          viewingPost ? 'hidden lg:block' : 'block',
        )}
      >
        <div className="sticky top-24 space-y-3.5">
          <Card padding="none" className="overflow-hidden rounded-3xl">
            <div className="h-1.5 w-full" style={{ background: chroma.gradient }} />
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/c/${encodeURIComponent(communityName)}`}
                  className="flex min-w-0 items-center gap-2.5 group"
                >
                  <Avatar
                    name={detail.data?.name ?? communityName}
                    src={detail.data?.avatarUrl}
                    size="sm"
                    shape="rounded"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-foreground group-hover:text-primary">
                      {detail.data?.name ?? communityName}
                    </p>
                    <p className="tabular-nums text-[11px] text-muted-foreground">
                      {String(detail.data?.memberCount ?? 0)} 位成员
                    </p>
                  </div>
                </Link>

                <div className="flex shrink-0 items-center gap-1.5">
                  <CommunitySwitcher currentName={communityName} />
                  <Link
                    to={`/c/${encodeURIComponent(communityName)}/new`}
                    title="发新帖"
                    className="btn-aurora inline-flex h-8 w-8 items-center justify-center rounded-xl"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </Card>

          <div className="max-h-[calc(100vh-14.5rem)] overflow-y-auto pr-0.5">
            <PostList communityId={detail.data?.id} communityName={communityName} />
          </div>
        </div>
      </aside>

      {/* 右栏：社群概览 / 帖子沉浸阅读 */}
      <section
        data-testid="right-pane"
        className="min-w-0 lg:col-span-8 xl:col-span-8"
      >
        {viewingPost && (
          <div className="mb-3 lg:hidden">
            <Link
              to={`/c/${encodeURIComponent(communityName)}`}
              className="glass-panel inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-primary" />
              返回「{communityName}」帖子列表
            </Link>
          </div>
        )}
        <Outlet />
      </section>
    </div>
  )
}
