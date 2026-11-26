import { api } from '@/shared/api/client'
import { ApiError } from '@/shared/api/api-error'
import { resolveErrorMessage } from '@/shared/api/error-codes.gen'
import { apiBaseUrl } from '@/shared/lib/env'
import type { OkData, RequestBody } from '@/shared/api/typed'
import { useSession } from '@/features/auth/session'
import type { CitationItem } from '@/features/ai/citation-renderer'

export type ConversationView = OkData<'createAiConversation'>
export type ConversationPage = OkData<'listAiConversations'>
export type MessagePage = OkData<'listAiMessages'>
export type QuotaView = OkData<'getAiQuota'>
export type SendMessageBody = RequestBody<'streamAiMessage'>
export type ComposeBody = RequestBody<'streamAiCompose'>
export type ActionResultBody = RequestBody<'reportAiActionResult'>
export type RetrievalScope = 'ALL' | 'MY_ONLY' | 'CURRENT_COMMUNITY'

export type ProfileEntryView = OkData<'listAiProfileEntries'>[number]
export type ProfileEntryRequest = RequestBody<'createAiProfileEntry'>
export type NotePage = OkData<'listAiNotes'>
export type NoteSummaryView = NonNullable<NotePage['items']>[number]
export type NoteDetailView = OkData<'getAiNote'>
export type NoteUpsertRequest = RequestBody<'createAiNote'>

export type ActionProposalView = {
  actionId: string
  type:
    | 'CREATE_POST'
    | 'FAVORITE_POSTS'
    | 'FOLLOW_USER'
    | 'JOIN_COMMUNITY'
    | 'UPDATE_NICKNAME'
    | 'UPDATE_AVATAR'
    | 'SAVE_PROFILE_ENTRY'
    | string
  payload: Record<string, unknown>
  status: 'PROPOSED' | 'EXECUTED' | 'FAILED' | 'REJECTED' | 'EXPIRED' | string
  result?: Record<string, unknown> | undefined
  expiresAt?: string | undefined
}

export type UiAiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: CitationItem[]
  actions: ActionProposalView[]
  streaming?: boolean | undefined
  toolLabel?: string | null | undefined
  createdAt?: string | undefined
}

export type SseCallbacks = {
  onMeta?: (data: { conversationId?: string; messageId?: string; quotaRemaining?: number }) => void
  onToolStatus?: (data: { tool?: string; phase?: string; label?: string }) => void
  onDelta?: (text: string) => void
  onCitations?: (citations: CitationItem[]) => void
  onAction?: (action: ActionProposalView) => void
  onDone?: (usage?: { promptTokens?: number; completionTokens?: number }) => void
  onError?: (code: number, message: string) => void
}

const BASE = '/api/ai'

export function createConversation() {
  return api.post<ConversationView>(`${BASE}/conversations`)
}

export function listConversations(cursor?: string | null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return api.get<ConversationPage>(`${BASE}/conversations${qs}`)
}

export function listMessages(conversationId: string, cursor?: string | null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return api.get<MessagePage>(`${BASE}/conversations/${encodeURIComponent(conversationId)}/messages${qs}`)
}

export function deleteConversation(conversationId: string) {
  return api.del<unknown>(`${BASE}/conversations/${encodeURIComponent(conversationId)}`)
}

export function getQuota() {
  return api.get<QuotaView>(`${BASE}/quota`)
}

export function listProfileEntries() {
  return api.get<ProfileEntryView[]>(`${BASE}/profile/entries`)
}

export function createProfileEntry(body: ProfileEntryRequest) {
  return api.post<ProfileEntryView>(`${BASE}/profile/entries`, body)
}

export function updateProfileEntry(id: string, body: ProfileEntryRequest) {
  return api.put<ProfileEntryView>(`${BASE}/profile/entries/${encodeURIComponent(id)}`, body)
}

export function deleteProfileEntry(id: string) {
  return api.del<unknown>(`${BASE}/profile/entries/${encodeURIComponent(id)}`)
}

export function listNotes(cursor?: string | null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return api.get<NotePage>(`${BASE}/notes${qs}`)
}

export function getNote(id: string) {
  return api.get<NoteDetailView>(`${BASE}/notes/${encodeURIComponent(id)}`)
}

export function createNote(body: NoteUpsertRequest) {
  return api.post<NoteDetailView>(`${BASE}/notes`, body)
}

export function updateNote(id: string, body: NoteUpsertRequest) {
  return api.put<NoteDetailView>(`${BASE}/notes/${encodeURIComponent(id)}`, body)
}

export function deleteNote(id: string) {
  return api.del<unknown>(`${BASE}/notes/${encodeURIComponent(id)}`)
}

export async function readSsePost(
  path: string,
  body: unknown,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = useSession.getState().accessToken
  if (!token) {
    throw new ApiError(40100, '请先登录后再使用 AI 助手', 401)
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: signal ?? null,
  })

  const ct = res.headers.get('content-type') ?? ''
  if (!res.ok || ct.includes('application/json')) {
    let code = res.status || 50000
    let message = '请求失败'
    try {
      const json = (await res.json()) as { code?: number; message?: string }
      if (typeof json.code === 'number') {
        code = json.code
        message = resolveErrorMessage(json.code, json.message ?? message)
      }
    } catch {
      // ignore json parse failure
    }
    callbacks.onError?.(code, message)
    return
  }

  if (!res.body) {
    callbacks.onError?.(50300, 'AI 服务暂时不可用')
    return
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
      const rawData = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')

      if (!rawData) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(rawData)
      } catch {
        continue
      }

      switch (name) {
        case 'meta':
          callbacks.onMeta?.(parsed as { conversationId?: string; messageId?: string; quotaRemaining?: number })
          break
        case 'tool_status':
          callbacks.onToolStatus?.(parsed as { tool?: string; phase?: string; label?: string })
          break
        case 'delta': {
          const text = (parsed as { text?: string }).text
          if (typeof text === 'string' && text.length > 0) {
            callbacks.onDelta?.(text)
          }
          break
        }
        case 'citations':
          callbacks.onCitations?.(Array.isArray(parsed) ? (parsed as CitationItem[]) : [])
          break
        case 'action':
          callbacks.onAction?.(parsed as ActionProposalView)
          break
        case 'done':
          callbacks.onDone?.((parsed as { usage?: { promptTokens?: number; completionTokens?: number } }).usage)
          break
        case 'error': {
          const errObj = parsed as { code?: number; message?: string }
          const code = typeof errObj.code === 'number' ? errObj.code : 44003
          callbacks.onError?.(code, resolveErrorMessage(code, errObj.message ?? 'AI 服务暂时不可用'))
          break
        }
      }
    }
  }
}

export function streamConversationMessage(
  conversationId: string,
  body: SendMessageBody,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
) {
  return readSsePost(`${BASE}/conversations/${encodeURIComponent(conversationId)}/messages`, body, callbacks, signal)
}

export function streamCompose(
  body: ComposeBody,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
) {
  return readSsePost(`${BASE}/compose`, body, callbacks, signal)
}

export function streamActionResult(
  actionId: string,
  body: ActionResultBody,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
) {
  return readSsePost(`${BASE}/actions/${encodeURIComponent(actionId)}/result`, body, callbacks, signal)
}
