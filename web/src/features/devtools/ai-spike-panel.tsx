import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/shared/api/client'
import { apiBaseUrl } from '@/shared/lib/env'
import type { OkData, RequestBody } from '@/shared/api/typed'
import { useSession } from '@/features/auth/session'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

type CreateConvRes = OkData<'createAiConversation'>
type StreamMsgBody = RequestBody<'streamAiMessage'>

/**
 * P8.0 流式穿透探针：浏览器 fetch/getReader → Nginx → Gateway → ai-service → LLM。
 * 挂载时不发任何请求；仅在点击发送时触发。
 */
export function AiSpikePanel() {
  const status = useSession((s) => s.status)
  const [prompt, setPrompt] = useState('你好，请用一句话介绍快看社区。')
  const [convId, setConvId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [events, setEvents] = useState<string[]>(['尚未发起对话'])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const appendEvent = (line: string) => {
    setEvents((prev) => [...prev, line])
  }

  const send = async () => {
    if (busy || !prompt.trim()) return
    const token = useSession.getState().accessToken
    if (!token) {
      setEvents(['✗ 请先登录后再发送 AI 对话'])
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setBusy(true)
    setReply('')
    setEvents(['建立会话中…'])

    try {
      let targetConvId = convId
      if (!targetConvId) {
        const conv = await api.post<CreateConvRes>('/api/ai/conversations')
        if (!conv.id) {
          throw new Error('新建会话未返回 id')
        }
        targetConvId = conv.id
        setConvId(targetConvId)
        setEvents([`✓ 会话已创建 id=${targetConvId}`])
      } else {
        setEvents([`复用会话 id=${targetConvId}`])
      }

      const body: StreamMsgBody = {
        content: prompt.trim(),
        pageContext: { type: 'OTHER' },
      }

      const res = await fetch(
        `${apiBaseUrl}/api/ai/conversations/${encodeURIComponent(targetConvId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      )

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${String(res.status)} ${text}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''

        for (const frame of frames) {
          if (!frame.trim() || frame.trim().startsWith(':')) continue
          const name = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim() ?? 'message'
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
          const rawData = dataLines.join('\n')

          if (name === 'delta') {
            try {
              const obj = JSON.parse(rawData) as { text?: string }
              if (obj.text) {
                setReply((prev) => prev + obj.text)
              }
            } catch {
              // ignore malformed delta
            }
          } else {
            appendEvent(`[${name}] ${rawData}`)
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        appendEvent(`✗ ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3" data-testid="ai-spike-panel">
      <CardTitle>AI SSE 流式穿透（P8.0 Spike）</CardTitle>
      <CardDescription>
        验证 浏览器 → Nginx → 网关 → ai-service → OpenAI 兼容流式输出；挂载时不请求。
      </CardDescription>

      {status !== 'authenticated' ? (
        <div className="text-caption text-muted-foreground">
          /api/ai/** 需要登录。请先{' '}
          <Link to="/login?returnTo=%2Ftest" className="underline">
            登录
          </Link>
          。
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              className="min-w-[240px] flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm"
              placeholder="输入测试消息…"
              data-testid="input-ai-spike"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void send()}
              disabled={busy}
              data-testid="btn-ai-spike"
            >
              {busy ? '流式接收中…' : '发送流式对话'}
            </Button>
            {convId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConvId(null)
                  setReply('')
                  setEvents(['已重置会话'])
                }}
                disabled={busy}
              >
                新会话
              </Button>
            )}
          </div>
          {reply && (
            <div
              className="rounded border border-border bg-background p-3 text-sm whitespace-pre-wrap"
              data-testid="ai-spike-reply"
            >
              {reply}
            </div>
          )}
        </div>
      )}

      <pre className="max-h-48 overflow-auto rounded border border-border bg-muted p-3 text-caption leading-relaxed">
        {events.join('\n')}
      </pre>
    </Card>
  )
}
