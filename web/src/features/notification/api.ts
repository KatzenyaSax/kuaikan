import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { apiBaseUrl } from '@/shared/lib/env'
import type { OkData } from '@/shared/api/typed'
import { useSession } from '@/features/auth/session'

export type MessagePage = OkData<'listMessages'>
export type MessageView = NonNullable<MessagePage['items']>[number]
export type Unread = OkData<'getUnread'>

export type MessageType = 'LIKE' | 'COMMENT' | 'MENTION' | 'FOLLOW' | 'SYSTEM'

export const MESSAGE_TABS: ReadonlyArray<{ key: MessageType; label: string }> = [
  { key: 'LIKE', label: '赞' },
  { key: 'COMMENT', label: '评论' },
  { key: 'MENTION', label: '@' },
  { key: 'FOLLOW', label: '关注' },
  { key: 'SYSTEM', label: '系统' },
]

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

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<number>(`${BASE}/messages/${encodeURIComponent(id)}/read`),
    onSuccess: () => {
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
      void qc.invalidateQueries({ queryKey: ['unread'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}

export type LiveSseEvent = {
  id?: string | undefined
  type?: MessageType | undefined
  receivedAt: number
}

/**
 * SSE 客户端（保留 fetch + ReadableStream 鉴权协议，新增连接态与实时事件回调，驱动右上角流光 Toast）。
 */
export function useMessageStream(onLiveMessage?: (ev: LiveSseEvent) => void) {
  const status = useSession((s) => s.status)
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const callbackRef = useRef(onLiveMessage)

  useEffect(() => {
    callbackRef.current = onLiveMessage
  }, [onLiveMessage])

  useEffect(() => {
    if (status !== 'authenticated') {
      return
    }

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
        if (!cancelled) setConnected(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const frames = buf.split('\n\n')
          buf = frames.pop() ?? ''
          for (const frame of frames) {
            const name = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim()
            const rawData = /^data:\s*(.+)$/m.exec(frame)?.[1]?.trim()
            if (name === 'message') {
              refresh()
              let parsedId: string | undefined
              let parsedType: MessageType | undefined
              if (rawData) {
                try {
                  const obj = JSON.parse(rawData) as { id?: string; type?: string }
                  parsedId = obj.id
                  if (
                    obj.type === 'LIKE' ||
                    obj.type === 'COMMENT' ||
                    obj.type === 'MENTION' ||
                    obj.type === 'FOLLOW' ||
                    obj.type === 'SYSTEM'
                  ) {
                    parsedType = obj.type
                  }
                } catch {
                  // ignore non-json payload
                }
              }
              callbackRef.current?.({
                id: parsedId,
                type: parsedType,
                receivedAt: Date.now(),
              })
            } else if (name === 'expired') {
              refresh()
            }
          }
        }
      } catch {
        // 退避重连
      }
      if (!cancelled) setConnected(false)
      if (cancelled) return
      retry = Math.min(retry + 1, 6)
      timer = setTimeout(() => void connect(), Math.min(1000 * 2 ** retry, 30_000))
    }

    void connect()
    return () => {
      cancelled = true
      setConnected(false)
      controller?.abort()
      if (timer) clearTimeout(timer)
    }
  }, [status, qc])

  return { connected: status === 'authenticated' && connected }
}
