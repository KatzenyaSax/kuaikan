import { useState } from 'react'
import { Link } from 'react-router'
import { useHotRank, type HotItem, type HotRange } from '@/features/rank/api'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 热榜。
 *
 * 数据来自 rank-service 的 Redis 投影，**每 5 分钟全量重建一次**。
 * 所以页面上的数字天然有最多 5 分钟滞后——这不是 bug，是设计。
 *
 * 榜上的帖子可能属于任何社群，链接要带上社群名（`/c/{社群名}/p/{帖子id}`）。
 * 社群名是重建时写进 Redis 的快照，读的时候不需要再查一次。
 */
export function HotPage() {
  const [range, setRange] = useState<HotRange>('day')
  const hot = useHotRank(range)
  const items = hot.data?.items ?? []

  return (
    <div className="mx-auto max-w-[40rem] px-6 pb-24 pt-12" data-testid="hot-page">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-title font-[640]">热榜</h1>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: 'day', label: '日榜' },
            { value: 'week', label: '周榜' },
          ]}
        />
      </div>

      {/*
        口径要写清楚。热度公式是产品规则，不写出来用户会以为"收藏没涨就是坏了"。
        另外两句话必不可少：分数会随时间衰减、榜每 5 分钟重算一次——
        否则用户会觉得"我明明刚点赞，怎么没动"。
      */}
      <p className="m-0 mb-2 text-aux leading-[1.7] text-muted-foreground">
        热度 = 评论 ×5 + 收藏 ×4 + 分享 ×3 + 点赞 ×2 + 浏览 ×0.5，
        对每个数取对数后加权，再按「距最后一次互动的时间」衰减。
        <br />
        {range === 'day' ? '日榜半衰期 24 小时' : '周榜半衰期 7 天'}
        ，每 5 分钟重算一次。
      </p>

      {hot.isPending ? (
        <ul className="m-0 mt-6 list-none p-0" aria-label="加载中">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-start gap-4 py-4.5 [&+&]:border-t [&+&]:border-border">
              <span className="w-7 shrink-0 text-sub font-semibold tabular-nums text-faint">
                {i + 1}
              </span>
              <span className="block min-w-0 flex-1">
                <Skeleton className="mb-2 block h-[15px] w-[62%]" />
                <Skeleton className="block h-[11px] w-[34%]" />
              </span>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="mt-10 rounded-lg bg-surface px-6 py-12 text-center" data-testid="hot-empty">
          <p className="m-0 mb-2 text-body font-medium">这一期还没有上榜内容</p>
          <p className="m-0 text-aux leading-[1.7] text-muted-foreground">
            帖子要有人评论、收藏、分享或点赞才会产生热度。
            <br />
            榜每 5 分钟重算一次，去发点什么吧。
          </p>
        </div>
      ) : (
        <ol className="m-0 mt-6 list-none p-0" data-testid="hot-list">
          {items.map((item) => (
            <li key={item.postId} className="[&+&]:border-t [&+&]:border-border">
              <HotRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * 一行。
 *
 * 前三名的序数字重一点——热榜是少数几个"排名本身有信息量"的地方，
 * 但只靠字重区分，不加金色/徽章那套装饰。
 */
function HotRow({ item }: { item: HotItem }) {
  const rank = item.rank ?? 0
  // 社群名是快照；社群被删时会为 null，那时只能退化成不可点的纯文本
  const href =
    item.communityName && item.postId
      ? `/c/${encodeURIComponent(item.communityName)}/p/${item.postId}`
      : null

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
    return <div className="flex items-start gap-4 py-4.5">{body}</div>
  }
  return (
    <Link
      to={href}
      className="flex items-start gap-4 py-4.5 transition-colors duration-[150ms] hover:bg-surface"
      data-testid="hot-item"
    >
      {body}
    </Link>
  )
}
