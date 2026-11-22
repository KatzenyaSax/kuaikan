import { useState } from 'react'
import { Link } from 'react-router'
import { useHotRank, type HotItem, type HotRange } from '@/features/rank/api'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Group, groupRowClass } from '@/shared/ui/group'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 栏宽与顶栏一致。底色 #f5f5f7 是 inset grouped 的前提：
 * 白分组必须有浅底衬托，否则分组只剩一排内缩 hairline（在白底上等于没有）。
 */
const CONTAINER = 'mx-auto w-full max-w-[980px] px-6 pb-24 pt-12'

/**
 * 热榜。
 *
 * 数据来自 rank-service 的 Redis 投影，**每 5 分钟全量重建一次**。
 * 所以页面上的数字天然有最多 5 分钟滞后——这不是 bug，是设计。
 *
 * 榜上的帖子可能属于任何社群，链接要带上社群名（`/c/{社群名}/p/{帖子id}`）。
 * 社群名是重建时写进 Redis 的快照，读的时候不需要再查一次。
 *
 * 排版是产品页：大标题 + 一行口径说明 + inset grouped 列表。
 */
export function HotPage() {
  const [range, setRange] = useState<HotRange>('day')
  const hot = useHotRank(range)
  const items = hot.data?.items ?? []

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] bg-surface" data-testid="hot-page">
      <div className={CONTAINER}>
        <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="m-0 text-title">热榜</h1>
            <p className="m-0 mt-2 max-w-[38rem] text-aux leading-[1.7] text-muted-foreground">
              热度 = 评论 ×5 + 收藏 ×4 + 分享 ×3 + 点赞 ×2 + 浏览 ×0.5，各自取对数后加权，
              再按距最后一次互动的时间衰减。
            </p>
          </div>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'day', label: '日榜' },
              { value: 'week', label: '周榜' },
            ]}
          />
        </header>

        {/*
          口径要写清楚。热度公式是产品规则，不写出来用户会以为"收藏没涨就是坏了"。
          另外两句话必不可少：分数会随时间衰减、榜每 5 分钟重算一次——
          否则用户会觉得"我明明刚点赞，怎么没动"。
        */}
        <p className="m-0 mb-6 text-caption text-faint">
          {range === 'day' ? '日榜半衰期 24 小时' : '周榜半衰期 7 天'} · 整榜每 5 分钟重算一次
        </p>

        {hot.isPending ? (
          <Group>
            <ul className="m-0 list-none p-0" aria-label="加载中">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-start gap-4 px-4 py-4">
                  <span className="w-7 shrink-0 text-sub font-semibold tabular-nums text-faint">
                    {i + 1}
                  </span>
                  <span className="block min-w-0 flex-1">
                    <Skeleton className="mb-2 block h-[15px] w-[62%]" />
                    <Skeleton className="block h-3 w-[34%]" />
                  </span>
                </li>
              ))}
            </ul>
          </Group>
        ) : items.length === 0 ? (
          <Group>
            <Empty
              testId="hot-empty"
              title="这一期还没有上榜内容"
              description={
                <>
                  帖子要有人评论、收藏、分享或点赞才会产生热度。
                  <br />
                  榜每 5 分钟重算一次，去发点什么吧。
                </>
              }
              action={
                <Link to="/">
                  <Button size="sm" variant="outline">
                    去首页看看
                  </Button>
                </Link>
              }
            />
          </Group>
        ) : (
          <Group>
            <ol className="m-0 list-none p-0" data-testid="hot-list">
              {items.map((item) => {
                const href = hrefOf(item)
                return (
                  <li
                    key={item.postId}
                    className={groupRowClass({ interactive: Boolean(href), className: 'p-0' })}
                  >
                    <HotRow item={item} href={href} />
                  </li>
                )
              })}
            </ol>
          </Group>
        )}
      </div>
    </div>
  )
}

/** 社群名是快照；社群被删时会为 null，那时只能退化成不可点的纯文本 */
function hrefOf(item: HotItem): string | null {
  return item.communityName && item.postId
    ? `/c/${encodeURIComponent(item.communityName)}/p/${item.postId}`
    : null
}

/**
 * 一行。
 *
 * 前三名的序数字重一点——热榜是少数几个"排名本身有信息量"的地方，
 * 但只靠字重区分，不加金色/徽章那套装饰。
 */
function HotRow({ item, href }: { item: HotItem; href: string | null }) {
  const rank = item.rank ?? 0

  const body = (
    <>
      <span
        className={
          'w-7 shrink-0 text-sub font-semibold tabular-nums ' +
          (rank <= 3 ? 'text-foreground' : 'text-faint')
        }
      >
        {rank}
      </span>
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">
          {item.title ?? '（无标题）'}
        </span>
        <span className="mt-1 flex items-center gap-2 text-caption text-faint">
          {item.communityName ? <span>{item.communityName}</span> : null}
          {item.communityName ? <span>·</span> : null}
          <span className="tabular-nums">热度 {item.score ?? 0}</span>
        </span>
      </span>
    </>
  )

  if (!href) {
    return <div className="flex w-full items-start gap-4 px-4 py-4">{body}</div>
  }
  return (
    <Link to={href} className="flex w-full items-start gap-4 px-4 py-4" data-testid="hot-item">
      {body}
    </Link>
  )
}
