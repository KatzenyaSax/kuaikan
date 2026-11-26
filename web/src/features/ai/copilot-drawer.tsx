import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BookmarkPlus, Check, History, Loader2, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import {
  createConversation,
  createNote,
  deleteConversation,
  getQuota,
  listConversations,
  listMessages,
  streamActionResult,
  streamConversationMessage,
} from '@/features/ai/api'
import type {
  ActionResultBody,
  ConversationView,
  QuotaView,
  RetrievalScope,
  UiAiMessage,
} from '@/features/ai/api'
import { ActionCard } from '@/features/ai/action-card'
import { CitationAnswer } from '@/features/ai/citation-renderer'
import { useAiStore } from '@/features/ai/ai-store'
import { Button } from '@/shared/ui/button'
import { Sheet } from '@/shared/ui/sheet'

type PageContextInfo = {
  type: 'POST' | 'COMMUNITY' | 'HOME' | 'SEARCH' | 'USER' | 'OTHER'
  postId?: string
  communityName?: string
  userId?: string
  label: string
}

function resolvePageContext(pathname: string): PageContextInfo {
  const postMatch = /^\/c\/([^/]+)\/p\/(\d+)/.exec(pathname)
  if (postMatch?.[1] && postMatch[2]) {
    let cname = postMatch[1]
    try {
      cname = decodeURIComponent(cname)
    } catch {
      // keep raw
    }
    return {
      type: 'POST',
      communityName: cname,
      postId: postMatch[2],
      label: `帖子 #${postMatch[2]}（#${cname}）`,
    }
  }

  const commMatch = /^\/c\/([^/]+)/.exec(pathname)
  if (commMatch?.[1]) {
    let cname = commMatch[1]
    try {
      cname = decodeURIComponent(cname)
    } catch {
      // keep raw
    }
    return { type: 'COMMUNITY', communityName: cname, label: `社群 #${cname}` }
  }

  const userMatch = /^\/u\/(\d+)/.exec(pathname)
  if (userMatch?.[1]) {
    return { type: 'USER', userId: userMatch[1], label: `用户主页 #${userMatch[1]}` }
  }

  if (pathname === '/') return { type: 'HOME', label: '发现画廊' }
  if (pathname === '/search') return { type: 'SEARCH', label: '全站搜索' }
  return { type: 'OTHER', label: '当前页面' }
}

export function CopilotDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingIntent = useAiStore((s) => s.pendingIntent)
  const consumePendingIntent = useAiStore((s) => s.consumePendingIntent)
  const setDraftCommentPrefill = useAiStore((s) => s.setDraftCommentPrefill)

  const [quota, setQuota] = useState<QuotaView | null>(null)
  const [conversations, setConversations] = useState<ConversationView[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiAiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [dismissedPath, setDismissedPath] = useState<string | null>(null)
  const [retrievalScope, setRetrievalScope] = useState<RetrievalScope>('ALL')
  const [savingNoteMsgId, setSavingNoteMsgId] = useState<string | null>(null)
  const [savedNoteIds, setSavedNoteIds] = useState<Record<string, string>>({})

  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const routeCtx = useMemo(() => resolvePageContext(location.pathname), [location.pathname])
  const contextDismissed = dismissedPath === location.pathname
  const hasCommunityCtx = Boolean(routeCtx.communityName)
  const effectiveScope: RetrievalScope =
    retrievalScope === 'CURRENT_COMMUNITY' && !hasCommunityCtx ? 'ALL' : retrievalScope

  const refreshQuotaAndList = useCallback(async () => {
    try {
      const [q, convPage] = await Promise.all([getQuota(), listConversations()])
      setQuota(q)
      setConversations(convPage.items ?? [])
    } catch {
      // ignore transient error
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.all([getQuota(), listConversations()])
      .then(([q, convPage]) => {
        if (cancelled) return
        setQuota(q)
        setConversations(convPage.items ?? [])
      })
      .catch(() => {
        // ignore transient error
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const selectConversation = async (convId: string) => {
    if (busy) return
    setHistoryOpen(false)
    setErrorBanner(null)
    setActiveConvId(convId)
    try {
      const page = await listMessages(convId)
      const list: UiAiMessage[] = (page.items ?? []).map((m) => ({
        id: m.id ?? String(Date.now()),
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content ?? '',
        citations: (m.citations ?? []).map((c, idx) => {
          const raw = c as Record<string, unknown>
          return {
            n: c.n ?? idx + 1,
            postId: c.postId ?? null,
            noteId: typeof raw['noteId'] === 'string' ? raw['noteId'] : null,
            sourceType: typeof raw['sourceType'] === 'string' ? raw['sourceType'] : 'POST',
            title: c.title ?? '',
            communityName: c.communityName ?? '',
            authorNickname: c.authorNickname ?? '',
          }
        }),
        actions: (m.actions ?? []).map((a) => ({
          actionId: a.actionId ?? '',
          type: a.type ?? '',
          payload: a.payload ?? {},
          status: a.status ?? 'PROPOSED',
          result: a.result,
          expiresAt: a.expiresAt,
        })),
        createdAt: m.createdAt,
      }))
      setMessages(list)
    } catch {
      setErrorBanner('加载历史消息失败')
    }
  }

  const startNewConversation = () => {
    if (busy) return
    setActiveConvId(null)
    setMessages([])
    setHistoryOpen(false)
    setErrorBanner(null)
  }

  const handleDeleteConv = async (convId: string) => {
    try {
      await deleteConversation(convId)
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeConvId === convId) {
        setActiveConvId(null)
        setMessages([])
      }
    } catch {
      setErrorBanner('删除会话失败')
    }
  }

  const sendMessage = useCallback(
    async (
      rawText: string,
      opts?: {
        intent?: string
        forceNewConv?: boolean
        pageContext?: {
          type: 'POST' | 'COMMUNITY' | 'HOME' | 'SEARCH' | 'USER' | 'OTHER'
          postId?: string
          communityName?: string
          userId?: string
        }
      },
    ) => {
      const text = rawText.trim()
      if (!text || busy) return

      setErrorBanner(null)
      setBusy(true)
      setHistoryOpen(false)

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      let convId = opts?.forceNewConv ? null : activeConvId
      try {
        if (!convId) {
          const created = await createConversation()
          if (!created.id) throw new Error('新建会话失败')
          convId = created.id
          setActiveConvId(convId)
          if (opts?.forceNewConv) {
            setMessages([])
          }
        }

        const userMsgId = `u-${String(Date.now())}`
        const assistantPlaceholderId = `a-${String(Date.now())}`
        setMessages((prev) => [
          ...prev,
          { id: userMsgId, role: 'user', content: text, citations: [], actions: [] },
          {
            id: assistantPlaceholderId,
            role: 'assistant',
            content: '',
            citations: [],
            actions: [],
            streaming: true,
            toolLabel: null,
          },
        ])

        const ctxPayload = opts?.pageContext
          ? opts.pageContext
          : contextDismissed
            ? undefined
            : {
                type: routeCtx.type,
                ...(routeCtx.postId ? { postId: routeCtx.postId } : {}),
                ...(routeCtx.communityName ? { communityName: routeCtx.communityName } : {}),
                ...(routeCtx.userId ? { userId: routeCtx.userId } : {}),
              }

        await streamConversationMessage(
          convId,
          {
            content: text,
            retrievalScope: effectiveScope,
            ...(opts?.intent ? { intent: opts.intent } : {}),
            ...(ctxPayload ? { pageContext: ctxPayload } : {}),
          },
          {
            onMeta: (meta) => {
              if (typeof meta.quotaRemaining === 'number') {
                setQuota((q) =>
                  q
                    ? { ...q, remaining: meta.quotaRemaining! }
                    : { dailyLimit: 50, used: 50 - meta.quotaRemaining!, remaining: meta.quotaRemaining! },
                )
              }
            },
            onToolStatus: (ts) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId
                    ? { ...m, toolLabel: ts.phase === 'start' ? (ts.label ?? '处理中…') : null }
                    : m,
                ),
              )
            },
            onDelta: (delta) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId
                    ? { ...m, content: m.content + delta, toolLabel: null }
                    : m,
                ),
              )
            },
            onCitations: (citations) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId ? { ...m, citations } : m,
                ),
              )
            },
            onAction: (action) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId
                    ? { ...m, actions: [...m.actions, action] }
                    : m,
                ),
              )
            },
            onDone: () => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId
                    ? { ...m, streaming: false, toolLabel: null }
                    : m,
                ),
              )
              void refreshQuotaAndList()
            },
            onError: (_code, msg) => {
              setErrorBanner(msg)
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantPlaceholderId
                    ? {
                        ...m,
                        streaming: false,
                        toolLabel: null,
                        content: m.content || `（${msg}）`,
                      }
                    : m,
                ),
              )
            },
          },
          controller.signal,
        )
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setErrorBanner(err instanceof Error ? err.message : '发送失败')
        }
      } finally {
        setBusy(false)
      }
    },
    [activeConvId, busy, contextDismissed, effectiveScope, refreshQuotaAndList, routeCtx],
  )

  // 响应帖子页「AI 总结」/ 消息抽屉「AI 速览」预设意图
  useEffect(() => {
    if (!open || !pendingIntent || busy) return
    const intentObj = pendingIntent
    const timer = window.setTimeout(() => {
      consumePendingIntent()
      void sendMessage(intentObj.prompt, {
        intent: intentObj.intent,
        forceNewConv: true,
        ...(intentObj.pageContext ? { pageContext: intentObj.pageContext } : {}),
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, pendingIntent, busy, consumePendingIntent, sendMessage])

  const handleReportActionResult = async (actionId: string, body: ActionResultBody) => {
    const followId = `f-${String(Date.now())}`
    setMessages((prev) => [
      ...prev,
      { id: followId, role: 'assistant', content: '', citations: [], actions: [], streaming: true },
    ])

    await streamActionResult(actionId, body, {
      onDelta: (delta) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === followId ? { ...m, content: m.content + delta } : m)),
        )
      },
      onDone: () => {
        setMessages((prev) =>
          prev.map((m) => (m.id === followId ? { ...m, streaming: false } : m)),
        )
      },
      onError: (_code, msg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === followId ? { ...m, streaming: false, content: m.content || msg } : m,
          ),
        )
      },
    })
  }

  const handleSaveAsNote = async (msgId: string, content: string) => {
    const clean = content.trim()
    if (!clean || savingNoteMsgId) return
    setSavingNoteMsgId(msgId)
    setErrorBanner(null)
    try {
      const firstLine =
        clean
          .split('\n')
          .map((l) => l.replace(/^#+\s*/, '').trim())
          .find((l) => l.length > 0) ?? 'Copilot 笔记'
      const title = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine
      const created = await createNote({
        title,
        content: clean.slice(0, 20000),
        enabled: true,
      })
      if (created.id) {
        setSavedNoteIds((prev) => ({ ...prev, [msgId]: created.id! }))
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : '存为笔记失败')
    } finally {
      setSavingNoteMsgId(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = input.trim()
    if (!val || busy) return
    setInput('')
    void sendMessage(val)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      testId="copilot-drawer"
      className="sm:max-w-[420px]"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>社区副驾驶</span>
          {quota && (
            <span
              data-testid="ai-quota"
              className="tabular-nums rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground"
            >
              今日剩余 {String(quota.remaining)}/{String(quota.dailyLimit)}
            </span>
          )}
        </span>
      }
      headerAction={
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={startNewConversation}
            data-testid="ai-new-conv"
            title="新建对话"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setHistoryOpen((v) => !v)}
            data-testid="ai-history-toggle"
            title="历史会话"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
    >
      <div className="flex h-full min-h-[420px] flex-col gap-3">
        {historyOpen && (
          <div
            data-testid="ai-history-list"
            className="max-h-56 space-y-1.5 overflow-y-auto rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-2.5"
          >
            <div className="px-1 text-[11px] font-semibold text-muted-foreground">历史会话</div>
            {conversations.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">暂无历史会话</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs hover:bg-[var(--bg-surface-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => c.id && void selectConversation(c.id)}
                    className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium text-foreground"
                  >
                    {c.title || '新对话'}
                  </button>
                  <button
                    type="button"
                    aria-label="删除会话"
                    onClick={() => c.id && void handleDeleteConv(c.id)}
                    className="cursor-pointer text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* 对话内容区 */}
        <div data-testid="ai-messages" className="flex-1 space-y-3 overflow-y-auto pr-0.5">
          {messages.length === 0 ? (
            <div className="space-y-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4 text-xs text-secondary-foreground">
              <p className="font-semibold text-foreground">你好，我可以帮你：</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>检索站内帖子并带真实引用总结回答</li>
                <li>快速省流当前帖子与热门评论观点</li>
                <li>总结未读消息并给出候选回复思路</li>
                <li>起草发帖/收藏/关注/改资料提议（确认后才执行）</li>
              </ul>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                data-testid={m.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-2xl bg-[var(--color-primary-soft)] px-3.5 py-2.5 text-sm text-foreground'
                    : 'mr-2 space-y-2 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-foreground'
                }
              >
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                ) : (
                  <>
                    {m.toolLabel && (
                      <div
                        data-testid="ai-tool-status"
                        className="inline-flex items-center gap-1.5 text-xs text-primary"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{m.toolLabel}</span>
                      </div>
                    )}
                    {m.content ? (
                      <CitationAnswer
                        content={m.content}
                        citations={m.citations}
                        streaming={m.streaming}
                      />
                    ) : (
                      m.streaming &&
                      !m.toolLabel && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          思考中…
                        </span>
                      )
                    )}
                    {m.actions.map((act) => (
                      <ActionCard
                        key={act.actionId}
                        action={act}
                        onReportResult={handleReportActionResult}
                      />
                    ))}
                    {!m.streaming && m.content && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {savedNoteIds[m.id] ? (
                          <Link
                            to={`/me?tab=notes&noteId=${encodeURIComponent(savedNoteIds[m.id]!)}`}
                            data-testid="ai-saved-note-link"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-success hover:underline"
                          >
                            <Check className="h-3 w-3" />
                            已存为笔记，去查看
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled={savingNoteMsgId === m.id}
                            data-testid="ai-save-as-note"
                            onClick={() => void handleSaveAsNote(m.id, m.content)}
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-secondary-foreground hover:text-primary disabled:opacity-50"
                          >
                            <BookmarkPlus className="h-3 w-3" />
                            {savingNoteMsgId === m.id ? '保存中…' : '存为笔记'}
                          </button>
                        )}
                        {routeCtx.postId && (
                          <button
                            type="button"
                            onClick={() => {
                              setDraftCommentPrefill(routeCtx.postId!, m.content.slice(0, 1800))
                              if (routeCtx.communityName && routeCtx.postId) {
                                void navigate(
                                  `/c/${encodeURIComponent(routeCtx.communityName)}/p/${encodeURIComponent(routeCtx.postId)}`,
                                )
                              }
                            }}
                            className="cursor-pointer text-[11px] font-medium text-primary hover:underline"
                          >
                            填入当前帖子评论框
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {errorBanner && (
          <div
            data-testid="ai-error-banner"
            className="rounded-xl border border-danger/30 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-danger"
          >
            {errorBanner}
          </div>
        )}

        {/* 检索范围切换 + 上下文标签 + 输入区 */}
        <div className="space-y-2 border-t border-[var(--border-glass)] pt-3">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="ai-scope-bar">
            {(
              [
                { id: 'ALL', label: '全部', testId: 'ai-scope-all', disabled: false },
                { id: 'MY_ONLY', label: '仅我的', testId: 'ai-scope-my', disabled: false },
                {
                  id: 'CURRENT_COMMUNITY',
                  label: '仅当前社群',
                  testId: 'ai-scope-community',
                  disabled: !hasCommunityCtx,
                },
              ] as const
            ).map((opt) => {
              const active = effectiveScope === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={opt.disabled || busy}
                  data-testid={opt.testId}
                  title={opt.disabled ? '进入社群或帖子页后可用' : undefined}
                  onClick={() => setRetrievalScope(opt.id)}
                  className={
                    active
                      ? 'cursor-pointer rounded-full border border-[rgba(var(--accent-rgb),0.45)] bg-[var(--color-primary-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-primary'
                      : 'cursor-pointer rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          {!contextDismissed && routeCtx.type !== 'OTHER' && (
            <div
              data-testid="ai-context-pill"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] text-secondary-foreground"
            >
              <span className="truncate">当前页面：{routeCtx.label}</span>
              <button
                type="button"
                aria-label="移除页面上下文"
                data-testid="ai-context-dismiss"
                onClick={() => setDismissedPath(location.pathname)}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
              placeholder="问站内帖子、总结当前页，或让我起草发布…"
              rows={2}
              disabled={busy}
              data-testid="ai-input"
              className="flex-1 resize-none rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[rgba(var(--accent-rgb),0.55)] focus:outline-none"
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || !input.trim()}
              data-testid="ai-send"
              className="h-10 rounded-2xl px-3.5"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>

          <p data-testid="ai-privacy-notice" className="text-center text-[10px] text-muted-foreground">
            对话内容会发送至第三方模型服务
          </p>
        </div>
      </div>
    </Sheet>
  )
}
