import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMyCommunities } from '@/features/community/api'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Empty } from '@/shared/ui/empty'
import { Sheet } from '@/shared/ui/sheet'
import { Link } from 'react-router'
import { cn } from '@/shared/lib/cn'

/**
 * 社群切换器：一个按钮 + 底部弹窗。
 *
 * 为什么用底部弹窗而不是下拉菜单 / 常驻列表：
 *   - 下拉菜单一行只能放文字，社群多了要滑很久，还容易误触
 *   - 常驻列表会一直占着左栏，把帖子列表往下推
 *   - 弹窗里能放**大卡片**（头像 + 名字 + 成员数），一眼扫完再点，误触率低
 *
 * 只列**已加入**的社群。发现新社群是「首页」的职责，不在这里混着。
 *
 * 排列用 2 列等宽网格：切换社群是"找并点"的高频动作，
 * 扫视效率优先于视觉惊喜；等宽也才让当前社群的高亮一眼认出来。
 */
export function CommunitySwitcher({ activeName }: { activeName: string | undefined }) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)
  const [open, setOpen] = useState(false)

  const items = mine.data?.items ?? []

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] bg-card px-3.5 text-aux transition-colors duration-[var(--duration-fast)] hover:bg-fill"
        data-testid="btn-community-switcher"
      >
        <span className="truncate">{activeName ?? '选择社群'}</span>
        <span
          aria-hidden
          className="h-[7px] w-[7px] shrink-0 -translate-y-0.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-faint"
        />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="我加入的社群"
        meta={items.length > 0 ? `${String(items.length)} 个` : undefined}
        testId="community-sheet"
      >
        {items.length === 0 ? (
          <Empty
            title="还没有加入任何社群"
            description="去首页看看有哪些社群，加入之后就会出现在这里。"
            action={
              <Link to="/" onClick={() => setOpen(false)} className="text-aux text-primary hover:underline">
                去首页看看
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((c) => {
              const active = c.name === activeName
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-current={active}
                  onClick={() => {
                    setOpen(false)
                    navigate(`/c/${encodeURIComponent(c.name ?? '')}`)
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-[var(--radius-lg)] p-3.5 text-left transition-colors duration-[var(--duration-fast)]',
                    active
                      ? 'bg-background shadow-[var(--shadow-soft)] ring-1 ring-border'
                      : 'bg-fill hover:bg-fill-strong',
                  )}
                  data-testid="community-sheet-item"
                >
                  <Avatar url={null} name={c.name ?? ''} size={40} />
                  <span className="block min-w-0">
                    <span className="block truncate text-body font-medium">{c.name}</span>
                    <span className="block text-caption text-faint">{c.memberCount} 成员</span>
                  </span>
                  {active ? (
                    <span className="ml-auto shrink-0 text-aux text-foreground" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}

        <p className="mt-4 text-caption text-faint">
          只列出你已加入的社群。发现新社群在「首页」。
        </p>
      </Sheet>
    </>
  )
}
