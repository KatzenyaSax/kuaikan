import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useUpdateProfile } from '@/features/auth/session-api'
import { useMyCommunities } from '@/features/community/api'
import type { ActionProposalView, ActionResultBody } from '@/features/ai/api'
import { ApiError } from '@/shared/api/api-error'
import { api } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/field'

function actionTitle(type: string): string {
  switch (type) {
    case 'CREATE_POST':
      return '发布新帖'
    case 'FAVORITE_POSTS':
      return '批量收藏帖子'
    case 'FOLLOW_USER':
      return '关注用户'
    case 'JOIN_COMMUNITY':
      return '加入社群'
    case 'UPDATE_NICKNAME':
      return '修改个人昵称'
    case 'UPDATE_AVATAR':
      return '修改个人头像'
    default:
      return '操作提议'
  }
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'EXECUTED':
      return { label: '已执行', cls: 'bg-[var(--color-success-soft)] text-success' }
    case 'FAILED':
      return { label: '执行失败', cls: 'bg-[var(--color-danger-soft)] text-danger' }
    case 'REJECTED':
      return { label: '已取消', cls: 'bg-[var(--bg-input)] text-muted-foreground' }
    case 'EXPIRED':
      return { label: '已过期', cls: 'bg-[var(--bg-input)] text-muted-foreground' }
    default:
      return { label: '待确认', cls: 'bg-[var(--color-primary-soft)] text-primary' }
  }
}

type FavoritePayloadItem = {
  postId: string
  title?: string | undefined
  communityName?: string | undefined
}

export function ActionCard({
  action,
  onReportResult,
}: {
  action: ActionProposalView
  onReportResult: (actionId: string, body: ActionResultBody) => Promise<void>
}) {
  const user = useSession((s) => s.user)
  const qc = useQueryClient()
  const updateProfile = useUpdateProfile()
  const { data: myComms } = useMyCommunities(action.type === 'CREATE_POST')

  const payload = action.payload ?? {}
  const [status, setStatus] = useState(action.status)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // CREATE_POST 可编辑字段
  const [communityId, setCommunityId] = useState(() => String(payload['communityId'] ?? ''))
  const [title, setTitle] = useState(() => String(payload['title'] ?? ''))
  const [body, setBody] = useState(() => String(payload['body'] ?? ''))

  // FAVORITE_POSTS 可逐条勾选
  const favItems: FavoritePayloadItem[] = Array.isArray(payload['items'])
    ? (payload['items'] as FavoritePayloadItem[])
    : []
  const [selectedPostIds, setSelectedPostIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const item of favItems) {
      if (item.postId) init[item.postId] = true
    }
    return init
  })

  const isProposed = status === 'PROPOSED'
  const badge = statusBadge(status)

  const communityOptions: Array<{ id: string; name: string }> = (() => {
    const map = new Map<string, string>()
    const rawComms = payload['communities']
    if (Array.isArray(rawComms)) {
      for (const c of rawComms as Array<{ id?: string; name?: string }>) {
        if (c.id && c.name) map.set(c.id, c.name)
      }
    }
    for (const c of myComms?.items ?? []) {
      if (c.id && c.name) map.set(c.id, c.name)
    }
    if (communityId && !map.has(communityId)) {
      map.set(communityId, String(payload['communityName'] ?? communityId))
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  })()

  const handleConfirm = async () => {
    if (!isProposed || busy) return
    setBusy(true)
    setErrMsg(null)

    let report: ActionResultBody
    try {
      switch (action.type) {
        case 'CREATE_POST': {
          const created = await api.post<{ id?: string }>('/api/content/posts', {
            communityId,
            title: title.trim(),
            body: body.trim(),
          })
          report = { status: 'EXECUTED', resultRef: created.id ?? '' }
          void qc.invalidateQueries({ queryKey: ['posts'] })
          break
        }
        case 'FAVORITE_POSTS': {
          const picked = favItems
            .map((i) => i.postId)
            .filter((id) => selectedPostIds[id])
          if (picked.length === 0) {
            setErrMsg('请至少勾选一篇帖子')
            setBusy(false)
            return
          }
          for (const postId of picked) {
            await api.post<void>('/api/interaction/favorites', {
              targetType: 'post',
              targetId: postId,
            })
          }
          report = { status: 'EXECUTED', resultRef: picked.join(',') }
          void qc.invalidateQueries({ queryKey: ['interaction'] })
          break
        }
        case 'FOLLOW_USER': {
          const targetUserId = String(payload['targetUserId'] ?? '')
          await api.post<void>(`/api/user/users/${encodeURIComponent(targetUserId)}/follow`)
          report = { status: 'EXECUTED', resultRef: targetUserId }
          void qc.invalidateQueries({ queryKey: ['social'] })
          break
        }
        case 'JOIN_COMMUNITY': {
          const communityName = String(payload['communityName'] ?? '')
          await api.post<unknown>(
            `/api/community/communities/${encodeURIComponent(communityName)}/membership`,
          )
          report = { status: 'EXECUTED', resultRef: communityName }
          void qc.invalidateQueries({ queryKey: ['communities'] })
          break
        }
        case 'UPDATE_NICKNAME': {
          const nickname = String(payload['nickname'] ?? '')
          await updateProfile.mutateAsync({ nickname })
          report = { status: 'EXECUTED', resultRef: nickname }
          break
        }
        case 'UPDATE_AVATAR': {
          const avatarUrl = String(payload['avatarUrl'] ?? '')
          await updateProfile.mutateAsync({ avatarUrl })
          report = { status: 'EXECUTED', resultRef: avatarUrl }
          break
        }
        default:
          throw new Error('未知操作类型')
      }

      setStatus('EXECUTED')
      await onReportResult(action.actionId, report)
    } catch (err) {
      const code = err instanceof ApiError && typeof err.code === 'number' ? err.code : 50000
      const msg = err instanceof Error ? err.message : '操作执行失败'
      setErrMsg(msg)
      setStatus('FAILED')
      await onReportResult(action.actionId, {
        status: 'FAILED',
        errorCode: code,
      })
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async () => {
    if (!isProposed || busy) return
    setBusy(true)
    setErrMsg(null)
    try {
      setStatus('REJECTED')
      await onReportResult(action.actionId, { status: 'REJECTED' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="ai-action-card"
      data-action-type={action.type}
      className="space-y-2.5 rounded-2xl border border-[rgba(var(--accent-rgb),0.35)] bg-[var(--bg-surface)] p-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-bold text-primary">
            <Sparkles className="h-2.5 w-2.5" />
            AI 提议
          </span>
          <span>{actionTitle(action.type)}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {action.type === 'CREATE_POST' && (
        <div className="space-y-2">
          <select
            value={communityId}
            disabled={!isProposed || busy}
            onChange={(e) => setCommunityId(e.target.value)}
            className="w-full rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-foreground"
            data-testid="ai-action-post-community"
          >
            {communityOptions.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
          <Input
            value={title}
            disabled={!isProposed || busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="帖子标题"
            maxLength={120}
            className="h-8 text-xs"
            data-testid="ai-action-post-title"
          />
          <Textarea
            value={body}
            disabled={!isProposed || busy}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={20000}
            className="text-xs"
            data-testid="ai-action-post-body"
          />
        </div>
      )}

      {action.type === 'FAVORITE_POSTS' && (
        <div className="space-y-1.5">
          {favItems.map((item) => (
            <label
              key={item.postId}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-2.5 py-1.5"
            >
              <input
                type="checkbox"
                checked={Boolean(selectedPostIds[item.postId])}
                disabled={!isProposed || busy}
                onChange={(e) =>
                  setSelectedPostIds((prev) => ({ ...prev, [item.postId]: e.target.checked }))
                }
              />
              <span className="truncate font-medium text-foreground">
                {item.title ?? `帖子 #${item.postId}`}
              </span>
              {item.communityName && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  #{item.communityName}
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {action.type === 'FOLLOW_USER' && (
        <div className="rounded-xl bg-[var(--bg-input)] px-2.5 py-2 text-secondary-foreground">
          目标作者：<strong className="text-foreground">{String(payload['targetNickname'] ?? '')}</strong>{' '}
          <span className="text-muted-foreground">(#{String(payload['targetUserId'] ?? '')})</span>
        </div>
      )}

      {action.type === 'JOIN_COMMUNITY' && (
        <div className="rounded-xl bg-[var(--bg-input)] px-2.5 py-2 text-secondary-foreground">
          目标社群：<strong className="text-foreground">#{String(payload['communityName'] ?? '')}</strong>
        </div>
      )}

      {action.type === 'UPDATE_NICKNAME' && (
        <div className="rounded-xl bg-[var(--bg-input)] px-2.5 py-2 text-secondary-foreground">
          <span>{user?.nickname ?? '当前昵称'}</span> →{' '}
          <strong className="text-foreground">{String(payload['nickname'] ?? '')}</strong>
        </div>
      )}

      {action.type === 'UPDATE_AVATAR' && (
        <div className="space-y-1 rounded-xl bg-[var(--bg-input)] px-2.5 py-2 text-secondary-foreground break-all">
          <div>当前：{user?.avatarUrl || '未设置'}</div>
          <div>
            变更为：<strong className="text-foreground">{String(payload['avatarUrl'] ?? '') || '清空头像'}</strong>
          </div>
        </div>
      )}

      {errMsg && <p className="text-[11px] font-medium text-danger">{errMsg}</p>}

      {isProposed && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleReject()}
            data-testid="ai-action-reject"
          >
            <X className="h-3.5 w-3.5" />
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleConfirm()}
            data-testid="ai-action-confirm"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            确认执行
          </Button>
        </div>
      )}
    </div>
  )
}
