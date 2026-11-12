import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCommunityList, useMyCommunities } from '@/features/community/api'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'

/**
 * 左栏顶部的社群切换器。
 *
 * **不是一个横向滚动的社群条。** 横向滚动有三个问题：不可发现（用户不知道右边还有）、
 * 不可扩展（100 个社群无法定位）、无障碍差。这里拆成两个不同的东西：
 *
 *   - **我加入的社群**：少量、稳定、高频切换 → 常驻
 *   - **全量社群**：搜索定位 → 可搜索下拉
 *
 * 社群搜索这里是 SQL LIKE（community-service 的列表接口带 q 参数）；
 * 与 P6 的 ES 搜索不是一回事——P6 搜的是帖子。
 */
export function CommunitySwitcher({ activeName }: { activeName: string | undefined }) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const all = useCommunityList(null)

  const filtered = useMemo(() => {
    const items = all.data?.items ?? []
    const k = keyword.trim().toLowerCase()
    if (!k) return items
    return items.filter((c) => (c.name ?? '').toLowerCase().includes(k))
  }, [all.data, keyword])

  const myItems = mine.data?.items ?? []

  return (
    <div className="border-b border-border p-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          data-testid="btn-community-switcher"
        >
          选择社群
        </Button>
        {authed ? (
          <Link
            to="/"
            className="text-[11px] text-muted-foreground underline"
            data-testid="link-all-communities"
          >
            全部
          </Link>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-2 rounded-md border border-border p-2">
          <input
            data-testid="field-community-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索社群"
            autoFocus
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <ul className="max-h-56 overflow-y-auto" data-testid="community-search-results">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate(`/c/${encodeURIComponent(c.name ?? '')}`)
                  }}
                  className="w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                  data-testid="community-search-item"
                >
                  {c.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-2 py-1 text-[11px] text-muted-foreground">没有匹配的社群</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {myItems.length > 0 ? (
        <ul className="mt-2 space-y-0.5" data-testid="my-community-list">
          {myItems.map((c) => {
            const active = c.name === activeName
            return (
              <li key={c.id}>
                <Link
                  to={`/c/${encodeURIComponent(c.name ?? '')}`}
                  className={
                    'block truncate rounded px-2 py-1 text-[11px] ' +
                    (active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')
                  }
                  data-testid="my-community-item"
                >
                  {c.name}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
