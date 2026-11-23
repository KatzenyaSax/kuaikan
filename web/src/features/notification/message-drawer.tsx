import { useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AtSign,
  Bell,
  CheckCheck,
  Heart,
  MessageCircle,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react'
import {
  MESSAGE_TABS,
  unreadCountOf,
  useMarkRead,
  useMessages,
  useReadAll,
  useUnread,
} from '@/features/notification/api'
import type { LiveSseEvent, MessageType, MessageView } from '@/features/notification/api'
import { MESSAGE_SEMANTICS } from '@/shared/theme/community-chroma'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Empty } from '@/shared/ui/empty'
import { Sheet } from '@/shared/ui/sheet'
import { Skeleton } from '@/shared/ui/skeleton'
import { relativeTime } from '@/shared/lib/time'
import { cn } from '@/shared/lib/cn'

function messageHref(m: MessageView): string | null {
  if (m.type === 'FOLLOW') {
    return m.actorId ? `/u/${encodeURIComponent(m.actorId)}` : null
  }
  if (!m.communityName || !m.postId) return null
  const base = `/c/${encodeURIComponent(m.communityName)}/p/${encodeURIComponent(m.postId)}`
  const params = new URLSearchParams()
  if (m.commentId) params.set('comment', m.commentId)
  if (m.rootCommentId) params.set('root', m.rootCommentId)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function messageActionText(m: MessageView): string {
  switch (m.type) {
    case 'LIKE':
      return m.targetType === 'COMMENT' ? '赞了你的评论' : '赞了你的帖子'
    case 'COMMENT':
      return m.rootCommentId ? '回复了你的评论' : '评论了你的帖子'
    case 'MENTION':
      return '在讨论中 @ 提到了你'
    case 'FOLLOW':
      return '关注了你'
    case 'SYSTEM':
      return '系统消息'
    default:
      return '发来一条新动态'
  }
}

function MessageTypeIcon({ type, className = 'h-3.5 w-3.5' }: { type?: string | undefined; className?: string }) {
  switch (type) {
    case 'LIKE':
      return <Heart className={className} />
    case 'COMMENT':
      return <MessageCircle className={className} />
    case 'MENTION':
      return <AtSign className={className} />
    case 'FOLLOW':
      return <UserPlus className={className} />
    default:
      return <Sparkles className={className} />
  }
}

function getSemantic(type?: string | undefined) {
  if (type && type in MESSAGE_SEMANTICS) {
    return MESSAGE_SEMANTICS[type as MessageType]
  }
  return MESSAGE_SEMANTICS.SYSTEM
}

export function MessageDrawer({
  open,
  onClose,
  initialTab,
  sseConnected,
}: {
  open: boolean
  onClose: () => void
  initialTab?: MessageType | undefined
  sseConnected: boolean
}) {
  const [tab, setTab] = useState<MessageType>(initialTab ?? 'LIKE')
  const { data: unread } = useUnread()
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(tab)
  const markRead = useMarkRead()
  const readAll = useReadAll()

  const items = data?.pages.flatMap((p) => p.items ?? []) ?? []
  const totalUnread = unread?.total ?? 0

  return (
    <Sheet
      open={open}
      onClose={onClose}
      testId="message-drawer"
      title={
        <span className="inline-flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <span>消息中心</span>
          {sseConnected && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-[var(--color-success-soft)] px-2 py-0.5 text-[10px] font-semibold text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              实时推送
            </span>
          )}
        </span>
      }
      subtitle={totalUnread > 0 ? `当前共有 ${String(totalUnread)} 条未读消息` : '全部消息已读'}
      headerAction={
        <Button
          size="sm"
          variant="ghost"
          data-testid="btn-read-all"
          disabled={totalUnread === 0 || readAll.isPending}
          onClick={() => readAll.mutate()}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          全部已读
        </Button>
      }
    >
      {/* 五色分类切换栏 */}
      <div className="mb-4 grid grid-cols-5 gap-1.5 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-1.5">
        {MESSAGE_TABS.map((t) => {
          const active = tab === t.key
          const count = unreadCountOf(unread, t.key)
          const sem = MESSAGE_SEMANTICS[t.key]
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'relative isolate flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold transition-colors',
                active ? 'text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId="msg-drawer-tab"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 z-0 rounded-xl shadow-md"
                  style={{ background: sem.gradient }}
                />
              )}
              <span className="relative z-10 flex flex-col items-center gap-1">
                <MessageTypeIcon type={t.key} className="h-3.5 w-3.5" />
                <span className="text-[11px]">{t.label}</span>
              </span>
              {count > 0 && (
                <span
                  className={cn(
                    'tabular-nums absolute top-1 right-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                    active ? 'bg-white text-slate-900' : 'text-white',
                  )}
                  style={active ? undefined : { background: sem.gradient }}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 列表区 */}
      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <Empty title="消息加载失败" description="请稍后刷新重试。" />
      ) : items.length === 0 ? (
        <Empty
          title="这里很安静"
          description={`暂时还没有新的「${MESSAGE_SEMANTICS[tab].label}」消息。`}
          icon={<MessageTypeIcon type={tab} className="h-5 w-5" />}
        />
      ) : (
        <div data-testid="message-list" className="space-y-2.5">
          {items.map((m) => {
            const href = messageHref(m)
            const isUnread = !m.readAt
            const sem = getSemantic(m.type)
            const actorName = m.actorNickname || '系统'

            const inner = (
              <div
                className={cn(
                  'group relative flex items-start gap-3 rounded-2xl border p-3.5 transition-all duration-200',
                  isUnread
                    ? 'border-[rgba(var(--accent-rgb),0.3)] bg-[var(--bg-surface-hover)]'
                    : 'border-[var(--border-glass)] bg-[var(--bg-surface)] hover:border-[var(--border-glass-strong)]',
                )}
              >
                <div className="relative shrink-0">
                  <Avatar name={actorName} src={m.actorAvatar} size="sm" />
                  <span
                    className="absolute -right-1 -bottom-1 flex h-4.5 w-4.5 items-center justify-center rounded-full text-white shadow"
                    style={{ background: sem.gradient }}
                  >
                    <MessageTypeIcon type={m.type} className="h-2.5 w-2.5" />
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-foreground">
                      <span className="font-semibold">{actorName}</span>{' '}
                      <span className="text-muted-foreground">{messageActionText(m)}</span>
                    </p>
                    <span className="tabular-nums shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(m.createdAt)}
                    </span>
                  </div>

                  {m.targetTitle && (
                    <p className="truncate text-xs font-medium text-secondary-foreground">
                      《{m.targetTitle}》
                    </p>
                  )}

                  {m.excerpt && (
                    <p className="line-clamp-2 rounded-xl bg-[var(--bg-input)] px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                      {m.excerpt}
                    </p>
                  )}

                  {m.communityName && (
                    <span className="inline-block text-[11px] font-medium text-primary/90">
                      #{m.communityName}
                    </span>
                  )}
                </div>

                {isUnread && (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full shadow"
                    style={{ background: sem.color, boxShadow: `0 0 8px ${sem.color}` }}
                  />
                )}
              </div>
            )

            const handleOpen = () => {
              if (isUnread && m.id) {
                markRead.mutate(m.id)
              }
              onClose()
            }

            return (
              <div key={m.id} data-testid="message-item">
                {href ? (
                  <Link
                    to={href}
                    data-testid="message-link"
                    onClick={handleOpen}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div onClick={handleOpen} className="cursor-pointer">
                    {inner}
                  </div>
                )}
              </div>
            )
          })}

          {hasNextPage && (
            <div className="pt-2 text-center">
              <Button
                variant="secondary"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? '正在加载…' : '加载更多消息'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/**
 * 右上角实时 SSE 悬浮流光 Toast：收到新赞/评/@/关注时立即流光弹出，点击直达消息抽屉。
 */
export function LiveMessageToast({
  event,
  onDismiss,
  onOpenDrawer,
}: {
  event: LiveSseEvent | null
  onDismiss: () => void
  onOpenDrawer: (tab?: MessageType) => void
}) {
  const sem = getSemantic(event?.type)

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key={event.receivedAt}
          initial={{ opacity: 0, x: 40, scale: 0.94 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 32, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="glass-panel-strong fixed top-20 right-5 z-50 w-80 overflow-hidden rounded-2xl p-3.5 shadow-2xl"
          style={{ borderColor: sem.border }}
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
              style={{ background: sem.gradient }}
            >
              <MessageTypeIcon type={event.type} className="h-4 w-4" />
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenDrawer(event.type)
                onDismiss()
              }}
              className="min-w-0 flex-1 cursor-pointer text-left"
            >
              <p className="text-xs font-bold text-foreground">
                收到新的「{sem.label}」动态
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                点击立即打开消息中心查看详情
              </p>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="关闭通知"
              className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 底部倒计时流光条 */}
          <motion.div
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: 5, ease: 'linear' }}
            className="mt-3 h-0.5 origin-left rounded-full"
            style={{ background: sem.gradient }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
