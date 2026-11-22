import { useState } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useMatch, useNavigate } from 'react-router'
import { useSession } from '@/features/auth/session'
import {
  MESSAGE_TABS,
  unreadCountOf,
  useMarkRead,
  useMessages,
  useMessageStream,
  useReadAll,
  useUnread,
  type MessageType,
  type MessageView,
} from '@/features/notification/api'
import { Avatar } from '@/shared/ui/avatar'
import { Group, groupRowClass } from '@/shared/ui/group'
import { Toaster } from '@/shared/ui/toast'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/c', label: '社群', end: false },
  { to: '/following', label: '关注', end: false },
  { to: '/hot', label: '热榜', end: false },
] as const

/**
 * 顶栏/底栏文字的基准样式（Apple 导航栏的做法）：aux 档，正文色 80% 透明，
 * hover 回到 100%。当前项靠**字重 + 100% 透明**表达，不额外加颜色块。
 */
const NAV_TEXT =
  'text-aux text-foreground/80 transition-colors duration-[var(--duration-fast)] hover:text-foreground'

/** 毛玻璃：Apple 的导航栏都不是半透明纯色，而是 saturate + blur 的“材质” */
const GLASS = 'bg-[rgba(255,255,255,0.72)] backdrop-blur-[20px] backdrop-saturate-[180%]'

/**
 * 应用外壳：顶栏 + 内容 + 底部 tab（窄屏）。
 *
 * 导航结构：
 *   左：品牌 + 主导航（首页 / 社群 / 关注 / 热榜 / 搜索）
 *   右：消息（带未读数）+ 头像昵称
 *
 * **「我的」不占顶栏位置** —— 点昵称进入。顶栏是最贵的位置，
 * 只留给需要"随时可达"的东西：切换场景（主导航）、看消息、确认身份。
 *
 * 搜索是全屏覆盖层而不是页面：搜索是瞬时任务，不该丢掉当前上下文。
 * 消息是右侧抽屉：读帖子时"瞥一眼消息"是轻任务。
 */
export function RootLayout() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [msgOpen, setMsgOpen] = useState(false)
  const authed = status === 'authenticated'
  const unread = useUnread()
  // SSE 只负责让红点及时亮起来；未读数永远以接口为准
  useMessageStream()
  // 双栏阅读页占满视口高度，页脚会让页面多出一条"为看页脚而滚"的细滚动条。
  // useMatch 必须在顶层无条件调用，不能写在条件里（hooks 顺序要稳定）。
  const communityMatch = useMatch('/c/:name/*')
  const inTwoPane = communityMatch !== null

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className={cn('sticky top-0 z-40 h-[var(--topbar-h)] border-b border-border', GLASS)}
      >
        <div className="mx-auto flex h-full w-full max-w-[980px] items-center gap-7 px-6">
          <Link to="/" className="shrink-0 text-body font-semibold tracking-[0.06em]">
            kuaikan
          </Link>

          {/* 主导航：不用图标，靠字重与颜色表达当前项 */}
          <nav className="hidden items-center gap-6 md:flex" aria-label="主导航">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(NAV_TEXT, isActive && 'font-semibold text-foreground')
                }
              >
                {n.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={NAV_TEXT}
              data-testid="nav-search"
            >
              搜索
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-5">
            <button
              type="button"
              onClick={() => setMsgOpen(true)}
              className={cn('inline-flex items-center', NAV_TEXT)}
              data-testid="nav-messages"
            >
              消息
              {/*
                未读徽标：全站唯一的红点，所以它一定意味着"有事情"。
                放在行内而不是绝对定位——绝对定位的 -top 会压在"息"字上，
                中文没有字母的上升部，压上去非常明显。
              */}
              {/* 未读为 0 时不渲染徽标本身：一个"0"比没有更吵 */}
              {(unread.data?.total ?? 0) > 0 ? (
                <span
                  className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-caption font-semibold leading-none text-white tabular-nums"
                  data-testid="nav-unread"
                >
                  {(unread.data?.total ?? 0) > 99 ? '99+' : unread.data?.total}
                </span>
              ) : null}
            </button>

            {authed && user ? (
              <button
                type="button"
                onClick={() => navigate('/me')}
                className={cn('flex items-center gap-2', NAV_TEXT)}
                data-testid="nav-user"
                title="我的"
              >
                <Avatar url={user.avatarUrl} name={user.nickname} size={24} />
                <span className="hidden max-w-[8em] truncate md:inline" data-testid="nav-nickname">
                  {user.nickname}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/login')}
                className={NAV_TEXT}
                data-testid="nav-login"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer
        className={cn(
          'border-t border-border pb-[var(--tabbar-h)] md:pb-0',
          inTwoPane && 'hidden md:block',
        )}
      >
        <div className="mx-auto w-full max-w-[980px] px-6 py-5 text-caption text-faint">
          kuaikan · 一个以社群为单位的讨论社区
        </div>
      </footer>

      {/* 窄屏：主导航进底部 tab bar。同样是毛玻璃材质，五个主导航一个不少 */}
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-45 border-t border-border pb-[env(safe-area-inset-bottom,0px)] md:hidden',
          GLASS,
        )}
        aria-label="底部导航"
        data-testid="tabbar"
      >
        <div className="grid h-[var(--tabbar-h)] grid-cols-5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-caption text-faint transition-colors duration-[var(--duration-fast)]',
                  isActive && 'font-semibold text-foreground',
                )
              }
            >
              {n.label}
              <span className="h-[3px] w-[3px] rounded-full bg-current opacity-0 [.font-semibold_&]:opacity-100 aria-[current=page]:opacity-100" />
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-caption text-faint"
          >
            搜索
            <span className="h-[3px] w-[3px] rounded-full bg-current opacity-0" />
          </button>
        </div>
      </nav>

      <SearchLayer open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MessageDrawer open={msgOpen} onClose={() => setMsgOpen(false)} />

      <ScrollRestoration />
      <Toaster />
    </div>
  )
}

/**
 * 全屏搜索层。
 *
 * 搜索还没做（P6），所以这里**只定形态、给一句诚实说明**，
 * 不摆一个假的搜索结果。
 */
function SearchLayer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-[rgba(255,255,255,0.86)] backdrop-blur-[30px] backdrop-saturate-[180%]"
      style={{ animation: 'fade-in var(--duration-base) var(--ease-out-soft) both' }}
      role="dialog"
      aria-modal="true"
      aria-label="搜索"
      data-testid="search-layer"
    >
      <div className="mx-auto max-w-[40rem] px-6 py-10">
        {/* 胶囊搜索框：与按钮同一种形状，一眼就知道这是"输入一条命令"的地方。
            focus 的指示器画在整条胶囊上（与外层一致），不用 input 自带的描边矩形 ——
            那会在胶囊里再套一个方框，形状打架。 */}
        <div className="flex h-12 items-center gap-3 rounded-full bg-fill px-5 transition-[background-color,box-shadow] duration-[var(--duration-fast)] focus-within:bg-background focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索帖子、社群、用户"
            aria-label="搜索"
            className="min-w-0 flex-1 bg-transparent text-read text-foreground outline-none placeholder:text-faint focus-visible:outline-none"
            data-testid="search-input"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-aux text-primary transition-colors duration-[var(--duration-fast)] hover:text-primary-hover"
            data-testid="search-close"
          >
            取消
          </button>
        </div>
        <p className="mt-4 text-aux text-muted-foreground">
          {q.trim()
            ? `「${q.trim()}」—— 搜索功能在后续版本开放`
            : '搜索功能在后续版本开放。这里先定下它的位置与形态。'}
        </p>
      </div>
    </div>
  )
}

/**
 * 消息抽屉。
 *
 * 五分类来自 p55-social.md §4.2：点赞 / 评论 / @ / 关注 / 系统。
 * 每类是**诚实的空态**，不是"假装没有消息"。
 *
 * 文案在前端拼（后端只给结构化字段）：改措辞不该动后端、不该发版。
 *
 * **FOLLOW 不参与折叠**：每一条关注都是一次可以「回关」的具体关系，
 * 合并成「X 等 N 人关注了你」会把入口弄丢（p55-social.md §1）。
 */
function MessageDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<MessageType>('LIKE')
  const unread = useUnread()
  const messages = useMessages(tab)
  const readAll = useReadAll()
  const raw = (messages.data?.pages ?? []).flatMap((p) => p.items ?? [])
  const items = foldMessages(raw)

  // 未读数按**字段名**取，不按位置解构：follow 是追加在 system 之后的字段
  const tabs = MESSAGE_TABS.map((t) => ({
    ...t,
    count: unreadCountOf(unread.data, t.key),
  }))

  const total = unread.data?.total ?? 0

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-50 bg-[rgba(0,0,0,0.32)] transition-opacity duration-[var(--duration-base)]',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="消息"
        data-testid="message-drawer"
        className={cn(
          // 抽屉本体是浅底（#f5f5f7），消息按 inset grouped 分组放在白面上，
          // 头部和 tab 保持白色 —— 与顶栏同一种材质，视觉上像从右边抽出来的一层。
          'fixed inset-y-0 right-0 z-[55] flex w-[min(420px,100vw)] flex-col bg-surface transition-transform duration-[var(--duration-base)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-border bg-background px-5">
          <div className="flex items-baseline gap-2.5">
            <h2 className="m-0 text-read font-semibold">消息</h2>
            {total > 0 ? (
              <button
                type="button"
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                className="text-aux text-primary transition-colors duration-[var(--duration-fast)] hover:text-primary-hover hover:underline disabled:opacity-50"
                data-testid="btn-read-all"
              >
                全部已读
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground"
          >
            关闭
          </button>
        </div>

        <div className="flex shrink-0 gap-5 border-b border-border bg-background px-5" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative h-11 text-aux transition-colors duration-[var(--duration-fast)]',
                tab === t.key ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {t.label}
              {t.count > 0 ? (
                <span className="ml-1 text-caption tabular-nums text-danger">{t.count}</span>
              ) : null}
              {tab === t.key ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto pb-10" data-testid="message-list">
          {messages.isPending ? (
            <p className="px-5 py-10 text-center text-aux text-faint">加载中…</p>
          ) : items.length === 0 ? (
            <EmptyTab tab={tab} />
          ) : (
            <div className="p-4">
              <Group>
                <ul className="m-0 list-none p-0">
                  {items.map((f) => (
                    <li
                      key={f.head.id}
                      className={groupRowClass({
                        interactive: true,
                        className: 'items-start px-4 py-3.5',
                      })}
                      data-testid="message-item"
                    >
                      <MessageRow
                        message={f.head}
                        sameTargetCount={f.sameTargetCount}
                        onClose={onClose}
                      />
                    </li>
                  ))}
                </ul>
              </Group>
            </div>
          )}
          {messages.hasNextPage ? (
            <button
              type="button"
              onClick={() => void messages.fetchNextPage()}
              disabled={messages.isFetchingNextPage}
              className="block w-full py-3 text-center text-aux text-primary disabled:opacity-50"
            >
              {messages.isFetchingNextPage ? '加载中…' : '加载更多'}
            </button>
          ) : null}
        </div>
      </aside>
    </>
  )
}

/** 空态。系统消息还没有产生者，如实说明，不摆假内容 */
function EmptyTab({ tab }: { tab: MessageType }) {
  const hint: Record<MessageType, string> = {
    LIKE: '还没有人赞过你的内容',
    COMMENT: '还没有评论消息',
    MENTION: '还没有人 @ 你',
    FOLLOW: '还没有人关注你',
    SYSTEM: '还没有系统通知',
  }
  return (
    <p className="px-5 py-14 text-center text-aux text-muted-foreground">{hint[tab]}</p>
  )
}

/**
 * 摘录只是"这条消息说了什么"的一句话提示，不是正文。
 *
 * 正文是 Markdown，直接截 120 字会把 `##`、`**`、反引号带进来，
 * 看起来像坏了。在**展示层**清掉而不是写入时清：
 * 已有的消息也能一起变干净，不需要回填。
 *
 * 只去掉最扎眼的几种标记，不做完整解析——过度清洗会把 `2*3` 变成 `23`。
 */
function cleanExcerpt(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')   // 标题
    .replace(/^\s{0,3}[-*+]\s+/gm, '')    // 无序列表
    .replace(/^\s{0,3}\d+\.\s+/gm, '')   // 有序列表
    .replace(/\*\*|__|`/g, '')            // 粗体 / 行内代码
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 折叠连赞：相邻的、同类型 + 同目标的消息合成一条。
 *
 * <b>只在展示层折叠，存储不折叠</b>（不变量 9）。每一次点赞都是独立的事实，
 * 但它们对读者是同一件事——"这条帖子被很多人赞了"。
 *
 * 只折叠**相邻**的：跨页或中间夹了别的消息就不合并。
 * 这是一条刻意保守的规则——为了合并而重排顺序，会让"最新在上"变得不可信。
 *
 * 只在 LIKE 上折叠。评论与 @ 每条都带着不同的话，合并了就丢了信息。
 */
type FoldedMessage = { head: MessageView; sameTargetCount: number; ids: string[] }

function foldMessages(items: MessageView[]): FoldedMessage[] {
  const out: FoldedMessage[] = []
  for (const m of items) {
    const last = out[out.length - 1]
    const mergeable =
      last &&
      m.type === 'LIKE' &&
      last.head.type === 'LIKE' &&
      m.targetId &&
      m.targetId === last.head.targetId &&
      m.postId === last.head.postId
    if (mergeable) {
      last.sameTargetCount += 1
      last.ids.push(m.id ?? '')
      continue
    }
    out.push({ head: m, sameTargetCount: 1, ids: [m.id ?? ''] })
  }
  return out
}

/**
 * 一条消息。
 *
 * 显式列出四种文案，而不是拼 `actorNickname + '赞了你'`——
 * 后者的措辞会散落在各个分支里，以后想改"赞了你"为"觉得不错"要翻遍代码。
 */
function MessageRow({
  message,
  sameTargetCount,
  onClose,
}: {
  message: MessageView
  /** 同一目标的连续点赞条数；>1 时显示"等 N 人" */
  sameTargetCount: number
  onClose: () => void
}) {
  const markRead = useMarkRead()
  const text = (() => {
    switch (message.type) {
      case 'LIKE':
        // 折叠后是"林间 等 5 人 赞了你的"——"等 N 人"而不是"和其他 N 人"，
        // 因为折叠的条数里已经包含了 head 自己
        return sameTargetCount > 1 ? `等 ${String(sameTargetCount)} 人 赞了你的` : '赞了你的'
      case 'COMMENT':
        return '评论了你的'
      case 'MENTION':
        return '在评论里提到了你'
      case 'FOLLOW':
        // 关注消息**不折叠**，所以永远只有单个 actor 的措辞
        return '关注了你'
      case 'SYSTEM':
        return '系统通知'
      default:
        return '有新消息'
    }
  })()
  const unread = !message.readAt
  // 跳转目标：
  //   FOLLOW → 对方的个人主页（/u/{actorId}），方便直接回关
  //   其余 → 帖子页（V2 之前写的消息没有社群名/帖子 id，当初没存），
  //          那种消息保持不可点——比点了跳到 404 好
  const href =
    message.type === 'FOLLOW'
      ? message.actorId
        ? `/u/${encodeURIComponent(message.actorId)}`
        : null
      : message.communityName && message.postId
        ? `/c/${encodeURIComponent(message.communityName)}/p/${message.postId}` +
          (message.commentId
            ? `?comment=${encodeURIComponent(message.commentId)}` +
              (message.rootCommentId ? `&root=${encodeURIComponent(message.rootCommentId)}` : '')
            : '')
        : null

  const body = (
    <div className="flex gap-3">
      <Avatar url={message.actorAvatar ?? null} name={message.actorNickname ?? ''} size={32} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-body leading-[1.6] text-foreground">
          <span className="font-medium">{message.actorNickname ?? '某人'}</span>{' '}
          <span className="text-muted-foreground">{text}</span>
          {message.targetTitle ? (
            <>
              {' '}
              <span className="font-medium">《{message.targetTitle}》</span>
            </>
          ) : null}
        </p>
        {cleanExcerpt(message.excerpt) ? (
          <p className="m-0 mt-1 line-clamp-2 text-aux text-faint">
            {cleanExcerpt(message.excerpt)}
          </p>
        ) : null}
        <p className="m-0 mt-1.5 flex items-center gap-2 text-caption text-faint">
          <span>{relativeTime(message.createdAt)}</span>
          {unread ? <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="未读" /> : null}
        </p>
      </div>
    </div>
  )

  return href ? (
    <Link
      to={href}
      onClick={() => {
        // 点开就是读过了。跳转不等它返回——一个"顺手"的请求不该挡住导航
        if (unread) markRead.mutate(message.id ?? '')
        onClose()
      }}
      className="block"
      data-testid="message-link"
    >
      {body}
    </Link>
  ) : (
    body
  )
}
