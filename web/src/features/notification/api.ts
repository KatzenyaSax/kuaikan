import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { apiBaseUrl } from '@/shared/lib/env'
import type { OkData } from '@/shared/api/typed'
import { useSession } from '@/features/auth/session'

export type MessagePage = OkData<'listMessages'>
export type MessageView = NonNullable<MessagePage['items']>[number]
export type Unread = OkData<'getUnread'>

/**
 * 五类消息（P5.5.1 追加 FOLLOW，后端 append-only）。
 *
 * Tab 顺序另有一个常量 {@link MESSAGE_TABS}：类型联合负责"能有哪些值"，
 * 那个数组负责"展示顺序"。两件事不要混在一起写，否则夹插顺序会重复一遍。
 */
export type MessageType = 'LIKE' | 'COMMENT' | 'MENTION' | 'FOLLOW' | 'SYSTEM'

/** 抽屉 Tab 顺序：点赞 / 评论 / @ / 关注 / 系统（p55-social.md §4.2） */
export const MESSAGE_TABS: ReadonlyArray<{ key: MessageType; label: string }> = [
  { key: 'LIKE', label: '赞' },
  { key: 'COMMENT', label: '评论' },
  { key: 'MENTION', label: '@' },
  { key: 'FOLLOW', label: '关注' },
  { key: 'SYSTEM', label: '系统' },
]

/**
 * 每类未读数。
 *
 * **按字段名读，不按位置解构**：`follow` 是追加在 `system` 之后的，
 * 若哪天后端再改顺序，按位置取会把"系统"的数目显示到"关注"上。
 */
export function unreadCountOf(unread: Unread | undefined, type: MessageType): number {
  if (!unread) return 0
  switch (type) {
    case 'LIKE':
      return unread.like ?? 0
    case 'COMMENT':
      return unread.comment ?? 0
    case 'MENTION':
      return unread.mention ?? 0
    case 'FOLLOW':
      return unread.follow ?? 0
    case 'SYSTEM':
      return unread.system ?? 0
  }
}

const BASE = '/api/notification'

export function useUnread() {
  const status = useSession((s) => s.status)
  return useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<Unread>(`${BASE}/unread`),
    enabled: status === 'authenticated',
    // 红点是"最新状态"的代表，缓存久了没有意义——SSE 出事时要靠它兜底
    staleTime: 0,
    refetchInterval: 60_000,
  })
}

export function useMessages(type: MessageType) {
  const status = useSession((s) => s.status)
  return useInfiniteQuery({
    queryKey: ['messages', type],
    queryFn: ({ pageParam }) =>
      api.get<MessagePage>(
        `${BASE}/messages?type=${type}&limit=20` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: status === 'authenticated',
  })
}

/**
 * 标记单条已读。点开一条消息时调用。
 *
 * **不 await**：跳转要立刻发生，不能等一个"顺手"的请求。
 * 失败了也只是红点多停一会儿，下次进抽屉会重新拉未读数把它纠正。
 */
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<number>(`${BASE}/messages/${encodeURIComponent(id)}/read`),
    onSuccess: () => {
      // 列表里的 readAt 变了（小圆点消失），未读数也要减
      void qc.invalidateQueries({ queryKey: ['unread'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}

export function useReadAll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<number>(`${BASE}/read-all`),
    onSuccess: () => {
      // 未读归零、列表里的 readAt 变了，两个都要刷
      void qc.invalidateQueries({ queryKey: ['unread'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}

/**
 * SSE 客户端。
 *
 * ## 为什么不用 EventSource
 *
 * `EventSource` 不能设请求头，token 只能进 query string——
 * 那会落进 nginx access_log、浏览器历史、Referer。
 * 所以用 `fetch` + `ReadableStream` 自己解析 `text/event-stream`。
 *
 * ## 断线不补发
 *
 * SSE 是**提示通道**：真相在 MySQL。所以重连后不做 Last-Event-ID 补发，
 * 只把 unread 与消息列表 invalidate 一次，让前端重新拉。
 * 这样即使漏了几帧，最终看到的也是正确的。
 *
 * ## 收到什么
 *
 * 只有 `{id, type}`——推送不携带消息内容。推送体丢了只是红点晚亮一会儿，
 * 不会显示出错误的内容。
 */
export function useMessageStream() {
  const status = useSession((s) => s.status)
  const qc = useQueryClient()

  useEffect(() => {
    if (status !== 'authenticated') return

    let cancelled = false
    let controller: AbortController | null = null
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['unread'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    }

    const connect = async () => {
      controller = new AbortController()
      try {
        const token = useSession.getState().accessToken
        if (!token) return
        const res = await fetch(`${apiBaseUrl}${BASE}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`SSE ${String(res.status)}`)

        retry = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // 事件以空行分隔
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? ''
          for (const frame of frames) {
            const name = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim()
            if (name === 'message') {
              refresh()
            } else if (name === 'expired') {
              // token 到点了，服务端主动断流。重连会带上刷新后的 token
              refresh()
            }
          }
        }
      } catch {
        // 网络抖动、服务重启、token 过期——都走同一条路：退避后重连
      }
      if (cancelled) return
      retry = Math.min(retry + 1, 6)
      timer = setTimeout(() => void connect(), Math.min(1000 * 2 ** retry, 30_000))
    }

    void connect()
    return () => {
      cancelled = true
      controller?.abort()
      if (timer) clearTimeout(timer)
    }
  }, [status, qc])
}
