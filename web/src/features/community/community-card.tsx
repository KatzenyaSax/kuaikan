import { Link } from 'react-router'
import type { CommunitySummary } from '@/features/community/api'

/**
 * 社群卡片。
 *
 * 链接用真实的社群名（浏览器地址栏显示中文）；服务端按 name_key 查找，
 * 所以大小写/全角半角差异都能命中。
 *
 * 计数为 0 时**不显示**——P2 阶段没有帖子，显示"0 帖"会像坏了。
 */
export function CommunityCard({ community }: { community: CommunitySummary }) {
  return (
    <Link
      to={`/c/${encodeURIComponent(community.name ?? '')}`}
      className="block rounded-lg border border-border p-4 transition-colors hover:bg-muted/40"
      data-testid="community-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium" data-testid="community-card-name">
          {community.name}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {community.memberCount} 成员
        </span>
      </div>
      {community.description ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{community.description}</p>
      ) : null}
    </Link>
  )
}
