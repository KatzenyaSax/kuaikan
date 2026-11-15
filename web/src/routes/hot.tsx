import { useState } from 'react'
import { Segmented } from '@/shared/ui/segmented'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * 热榜（P5）。
 *
 * 结构先做全：日榜/周榜分段、排名、标题、所属社群与热度值。
 * 数据用**骨架占位**而不是假数据 —— 假数据会让人误以为有内容，
 * 骨架一眼就能看出"这是尚未填充的位置"。
 *
 * 口径写死在页面上（热度 = 点赞 + 评论，收藏不计入），
 * 免得以后有人问"为什么收藏了热度没涨"。
 */
export function HotPage() {
  const [range, setRange] = useState<'day' | 'week'>('day')

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

      <p className="m-0 mb-2 text-aux text-muted-foreground">
        热度 = 点赞数 + 评论数（收藏不计入）。只取前 50，不做深度分页。
      </p>

      <ul className="m-0 mt-6 list-none p-0" aria-label="热榜占位">
        {[0, 1, 2, 3, 4].map((i) => (
          <li
            key={i}
            className="flex items-start gap-4 py-4.5 [&+&]:border-t [&+&]:border-border"
          >
            <span
              className={
                'w-7 shrink-0 text-sub font-semibold tabular-nums ' +
                (i === 0 ? 'text-foreground' : 'text-faint')
              }
            >
              {i + 1}
            </span>
            <span className="block min-w-0 flex-1">
              <Skeleton className="mb-2 block h-[15px] w-[62%]" />
              <Skeleton className="block h-[11px] w-[34%]" />
            </span>
          </li>
        ))}
      </ul>

      <div className="px-6 py-10 text-center">
        <p className="mb-2 text-body font-medium">热榜还在建设中</p>
        <p className="text-aux text-muted-foreground">
          上面是它上线后的结构：排名、标题、所属社群与热度值。
          <br />
          每天与每周各一份，只取前 50。
        </p>
      </div>
    </div>
  )
}
