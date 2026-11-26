import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  createProfileEntry,
  deleteProfileEntry,
  listProfileEntries,
  updateProfileEntry,
} from '@/features/ai/api'
import type { ProfileEntryView } from '@/features/ai/api'
import { ApiError } from '@/shared/api/api-error'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Textarea } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { Toast } from '@/shared/ui/toast'

const CATEGORIES = [
  { value: 'IDENTITY', label: '身份背景' },
  { value: 'PREFERENCE', label: '技术与偏好' },
  { value: 'STYLE', label: '写作风格' },
  { value: 'OTHER', label: '其他' },
] as const

function categoryLabel(cat?: string): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? '其他'
}

export function ProfilePanel() {
  const qc = useQueryClient()
  const entriesQuery = useQuery({
    queryKey: ['ai', 'profile'],
    queryFn: listProfileEntries,
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('PREFERENCE')
  const [content, setContent] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['ai', 'profile'] })

  const createMut = useMutation({
    mutationFn: () => createProfileEntry({ category, content: content.trim(), enabled: true, source: 'MANUAL' }),
    onSuccess: () => {
      setContent('')
      setErrorMsg(null)
      setNotice('已新增 AI 档案条目')
      invalidate()
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '保存失败'),
  })

  const updateMut = useMutation({
    mutationFn: (args: { id: string; category?: string; content?: string; enabled?: boolean }) =>
      updateProfileEntry(args.id, {
        ...(args.category !== undefined ? { category: args.category } : {}),
        ...(args.content !== undefined ? { content: args.content } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      }),
    onSuccess: () => {
      setEditingId(null)
      setContent('')
      setErrorMsg(null)
      setNotice('已更新档案条目')
      invalidate()
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '更新失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProfileEntry(id),
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('已删除档案条目')
      invalidate()
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '删除失败'),
  })

  const entries = entriesQuery.data ?? []

  const startEdit = (e: ProfileEntryView) => {
    setEditingId(e.id ?? null)
    setCategory(e.category ?? 'PREFERENCE')
    setContent(e.content ?? '')
    setErrorMsg(null)
    setNotice(null)
  }

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const clean = content.trim()
    if (!clean) {
      setErrorMsg('档案内容不能为空')
      return
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, category, content: clean })
    } else {
      createMut.mutate()
    }
  }

  return (
    <Card padding="md" data-testid="ai-profile-panel" className="rounded-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold text-foreground">我的 AI 档案</h2>
          <span className="tabular-nums text-xs text-muted-foreground">
            ({String(entries.length)}/30)
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          已启用条目将在每次 Copilot 对话与 AI 帮写中优先遵循
        </span>
      </div>

      {notice && (
        <Toast tone="success" message={notice} onClose={() => setNotice(null)} />
      )}
      {errorMsg && (
        <Toast tone="danger" message={errorMsg} onClose={() => setErrorMsg(null)} />
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="ai-profile-category"
            className="rounded-xl border border-[var(--border-glass)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {String(content.trim().length)}/200 字
          </span>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="例如：我是后端 Java 工程师，偏好简洁直入重点、带代码片段的技术回答…"
          data-testid="ai-profile-content"
        />
        <div className="flex justify-end gap-2">
          {editingId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingId(null)
                setContent('')
              }}
            >
              取消编辑
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={createMut.isPending || updateMut.isPending || !content.trim()}
            data-testid="ai-profile-save"
          >
            <Plus className="h-3.5 w-3.5" />
            {editingId ? '保存修改' : '添加档案条目'}
          </Button>
        </div>
      </form>

      {entriesQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] py-8 text-center text-xs text-muted-foreground">
          还没有 AI 档案条目。你可以手动添加，或在 Copilot 对话中对它说“记住我的偏好…”。
        </div>
      ) : (
        <div className="space-y-2" data-testid="ai-profile-list">
          {entries.map((entry) => (
            <div
              key={entry.id}
              data-testid="ai-profile-item"
              className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone="primary">{categoryLabel(entry.category)}</Pill>
                  <Pill tone="default">
                    {entry.source === 'AI_CONFIRMED' ? 'AI 确认' : '手动录入'}
                  </Pill>
                  {!entry.enabled && <Pill tone="warning">已停用</Pill>}
                </div>
                <p
                  className={
                    entry.enabled
                      ? 'text-sm text-foreground'
                      : 'text-sm text-muted-foreground line-through'
                  }
                >
                  {entry.content}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="ai-profile-toggle"
                  onClick={() =>
                    entry.id && updateMut.mutate({ id: entry.id, enabled: !entry.enabled })
                  }
                >
                  {entry.enabled ? '停用' : '启用'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="ai-profile-edit"
                  onClick={() => startEdit(entry)}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="ai-profile-delete"
                  onClick={() => entry.id && deleteMut.mutate(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
