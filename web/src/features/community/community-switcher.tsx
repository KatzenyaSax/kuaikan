import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Layers, Users } from 'lucide-react'
import { useCommunityList } from '@/features/community/api'
import { Avatar } from '@/shared/ui/avatar'
import { Sheet } from '@/shared/ui/sheet'
import { cn } from '@/shared/lib/cn'

export function CommunitySwitcher({ currentName }: { currentName: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useCommunityList(null)
  const items = data?.items ?? []

  return (
    <>
      <button
        type="button"
        data-testid="btn-community-switcher"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground transition-all hover:border-[rgba(var(--accent-rgb),0.5)] hover:text-foreground"
      >
        <Layers className="h-3.5 w-3.5 text-primary" />
        <span>切换</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        side="left"
        title="切换社群"
      >
        <div className="space-y-2">
          {items.map((c) => {
            const name = c.name ?? ''
            const active = name === currentName
            return (
              <Link
                key={c.id}
                to={`/c/${encodeURIComponent(name)}`}
                data-testid="community-sheet-item"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border p-3 transition-all',
                  active
                    ? 'border-[rgba(var(--accent-rgb),0.55)] bg-[var(--color-primary-soft)]'
                    : 'border-[var(--border-glass)] bg-[var(--bg-surface)] hover:border-[var(--border-glass-strong)] hover:bg-[var(--bg-surface-hover)]',
                )}
              >
                <Avatar name={name} src={c.avatarUrl} size="sm" shape="rounded" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{name}</p>
                </div>
                <span className="tabular-nums inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {String(c.memberCount ?? 0)}
                </span>
              </Link>
            )
          })}
        </div>
      </Sheet>
    </>
  )
}
