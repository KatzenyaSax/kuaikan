import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { cn } from '@/shared/lib/cn'

/**
 * 顶栏搜索框（p6-search.md §6）。
 *
 * 形态与搜索页里的输入框同一种语言：**淡填充胶囊、无边框**，靠形状而不是描边
 * 告诉人"这里可以输入"。顶栏是最贵的位置，所以它做得比导航文字安静一档。
 *
 * 交互只有一条：**回车提交**（不做输入即跳转）。搜索是"想好了再问"的动作，
 * 边打边跳会把历史记录塞满一串半截关键词，浏览器后退变得没法用。
 *
 * 提交行为分两种：
 *   - 不在 /search → 跳到 `/search?q=<encoded>`
 *   - 已在 /search → 只替换 q，**保留 sort / communityId**，否则在筛选了社群之后
 *     再搜一次会把筛选悄悄清掉（用户会以为是"筛选坏了"）。
 *
 * 输入框是**非受控**的，`key={urlQ}` 让 URL 的 q 变化（浏览器后退、页内搜索框提交）
 * 时重新挂载并取到正确的初始值。这样不必写一个"用 effect 把 URL 同步进 state"
 * 的胶水（那会让每次导航多一轮渲染，也容易被漏写）。
 */
export function TopbarSearch() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const onSearchPage = pathname === '/search'
  const urlQ = onSearchPage ? (params.get('q') ?? '') : ''

  const submit = (form: HTMLFormElement) => {
    const raw = new FormData(form).get('q')
    const q = typeof raw === 'string' ? raw.trim() : ''
    if (!q) return
    if (onSearchPage) {
      const next = new URLSearchParams(params)
      next.set('q', q)
      navigate(`/search?${next.toString()}`, { replace: true })
      return
    }
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(e.currentTarget)
      }}
      className={cn(
        'flex h-8 items-center rounded-full bg-fill px-3',
        'transition-[background-color,box-shadow] duration-[var(--duration-fast)]',
        'focus-within:bg-background focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)]',
      )}
    >
      <input
        key={urlQ}
        type="search"
        name="q"
        defaultValue={urlQ}
        placeholder="搜索"
        aria-label="全站搜索"
        data-testid="topbar-search-input"
        className="w-[7.5rem] min-w-0 bg-transparent text-aux text-foreground outline-none placeholder:text-faint focus-visible:outline-none sm:w-52 [&::-webkit-search-cancel-button]:appearance-none"
      />
    </form>
  )
}
