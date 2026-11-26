import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Eye, FileText, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote,
} from '@/features/ai/api'
import { ConfirmDialog } from '@/features/community/dialog'
import { ApiError } from '@/shared/api/api-error'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input, Textarea } from '@/shared/ui/field'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { Toast } from '@/shared/ui/toast'

function NoteEditor({
  selectedId,
  initialTitle,
  initialContent,
  initialEnabled,
  isSaving,
  onSave,
  onRequestDelete,
}: {
  selectedId: string | null
  initialTitle: string
  initialContent: string
  initialEnabled: boolean
  isSaving: boolean
  onSave: (data: { title: string; content: string; enabled: boolean }) => void
  onRequestDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [preview, setPreview] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    onSave({ title: title.trim(), content: content.trim(), enabled })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4 lg:col-span-7"
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        placeholder="笔记标题（最多 100 字）"
        data-testid="ai-note-title"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-2 text-secondary-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="ai-note-enabled"
          />
          <span>参与 Copilot 语义检索</span>
        </label>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {String(content.trim().length)}/20000 字
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="ai-note-preview-toggle"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {preview ? '编辑' : '预览'}
          </Button>
        </div>
      </div>

      {preview ? (
        <div
          data-testid="ai-note-preview"
          className="prose-aurora min-h-[220px] rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-surface)] p-3.5 text-sm leading-relaxed"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || '*（暂无正文）*'}
          </ReactMarkdown>
        </div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          maxLength={20000}
          placeholder="支持 Markdown 语法记录个人学习笔记、总结或资料…"
          data-testid="ai-note-content"
        />
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          {selectedId && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="ai-note-delete"
              onClick={() => onRequestDelete(selectedId)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              彻底删除
            </Button>
          )}
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={isSaving || !title.trim() || !content.trim()}
          data-testid="ai-note-save"
        >
          {selectedId ? '保存修改' : '保存新建笔记'}
        </Button>
      </div>
    </form>
  )
}

export function NotesPanel({ initialNoteId }: { initialNoteId?: string | undefined }) {
  const qc = useQueryClient()
  const notesQuery = useQuery({
    queryKey: ['ai', 'notes'],
    queryFn: () => listNotes(),
  })

  const [prevInitialId, setPrevInitialId] = useState(initialNoteId)
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId ?? null)
  const [draftNonce, setDraftNonce] = useState(0)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (initialNoteId && initialNoteId !== prevInitialId) {
    setPrevInitialId(initialNoteId)
    setSelectedId(initialNoteId)
  }

  const detailQuery = useQuery({
    queryKey: ['ai', 'note', selectedId],
    queryFn: () => getNote(selectedId!),
    enabled: Boolean(selectedId),
  })

  const invalidate = (id?: string | null) => {
    void qc.invalidateQueries({ queryKey: ['ai', 'notes'] })
    if (id) {
      void qc.invalidateQueries({ queryKey: ['ai', 'note', id] })
    }
  }

  const createMut = useMutation({
    mutationFn: (data: { title: string; content: string; enabled: boolean }) => createNote(data),
    onSuccess: (created) => {
      setErrorMsg(null)
      setNotice('已新建私密笔记并加入同步队列')
      if (created.id) setSelectedId(created.id)
      invalidate(created.id)
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '新建笔记失败'),
  })

  const updateMut = useMutation({
    mutationFn: (data: { title: string; content: string; enabled: boolean }) =>
      updateNote(selectedId!, data),
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('已保存笔记修改并同步更新向量')
      invalidate(selectedId)
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '保存笔记失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      setDeleteTargetId(null)
      setSelectedId(null)
      setDraftNonce((n) => n + 1)
      setErrorMsg(null)
      setNotice('已彻底删除笔记及对应向量切片')
      void qc.invalidateQueries({ queryKey: ['ai', 'notes'] })
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : '删除失败'),
  })

  const notes = notesQuery.data?.items ?? []

  const startNew = () => {
    setSelectedId(null)
    setDraftNonce((n) => n + 1)
    setErrorMsg(null)
    setNotice(null)
  }

  const detail = detailQuery.data
  const editorKey = selectedId
    ? `edit-${selectedId}-${detail?.id === selectedId ? (detail.updatedAt ?? 'loaded') : 'loading'}`
    : `new-${String(draftNonce)}`

  return (
    <Card padding="md" data-testid="ai-notes-panel" className="rounded-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold text-foreground">我的私密笔记</h2>
          <span className="tabular-nums text-xs text-muted-foreground">
            ({String(notes.length)}/200)
          </span>
        </div>
        <Button type="button" variant="secondary" size="sm" data-testid="ai-note-new" onClick={startNew}>
          <Plus className="h-3.5 w-3.5" />
          新建笔记
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-2.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          私密笔记严格按本人隔离，不会进入社区公共搜索。已启用的笔记在被 Copilot 检索命中时，相关片段会随对话发送至第三方模型服务。
        </span>
      </div>

      {notice && <Toast tone="success" message={notice} onClose={() => setNotice(null)} />}
      {errorMsg && <Toast tone="danger" message={errorMsg} onClose={() => setErrorMsg(null)} />}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-5" data-testid="ai-note-list">
          {notesQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] py-8 text-center text-xs text-muted-foreground">
              暂无私密笔记，可在右侧编写或从 Copilot 回答一键存为笔记。
            </div>
          ) : (
            notes.map((n) => {
              const active = selectedId === n.id
              return (
                <button
                  key={n.id}
                  type="button"
                  data-testid="ai-note-item"
                  onClick={() => {
                    if (n.id) {
                      setSelectedId(n.id)
                      setNotice(null)
                      setErrorMsg(null)
                    }
                  }}
                  className={
                    active
                      ? 'w-full cursor-pointer rounded-2xl border border-[rgba(var(--accent-rgb),0.55)] bg-[var(--color-primary-soft)] px-3.5 py-2.5 text-left'
                      : 'w-full cursor-pointer rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-2.5 text-left hover:bg-[var(--bg-surface-hover)]'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{n.title}</span>
                    {!n.enabled && <Pill tone="warning">已停用</Pill>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.excerpt}</p>
                </button>
              )
            })
          )}
        </div>

        <NoteEditor
          key={editorKey}
          selectedId={selectedId}
          initialTitle={selectedId && detail?.id === selectedId ? (detail.title ?? '') : ''}
          initialContent={selectedId && detail?.id === selectedId ? (detail.content ?? '') : ''}
          initialEnabled={selectedId && detail?.id === selectedId ? Boolean(detail.enabled) : true}
          isSaving={createMut.isPending || updateMut.isPending}
          onSave={(data) => (selectedId ? updateMut.mutate(data) : createMut.mutate(data))}
          onRequestDelete={(id) => setDeleteTargetId(id)}
        />
      </div>

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteTargetId && deleteMut.mutate(deleteTargetId)}
        title="确认彻底删除这篇笔记？"
        description="删除后原文与对应向量切片将被永久清除，无法恢复。"
        confirmLabel="彻底删除"
        danger
        pending={deleteMut.isPending}
        testId="ai-note-delete-dialog"
        confirmTestId="ai-note-confirm-delete"
      />
    </Card>
  )
}
