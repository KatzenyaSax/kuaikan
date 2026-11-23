import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Sparkles } from 'lucide-react'
import { useCreateCommunity } from '@/features/community/api'
import { Dialog } from '@/features/community/dialog'
import { ApiError } from '@/shared/api/api-error'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { Button } from '@/shared/ui/button'
import { Field, Input, Textarea } from '@/shared/ui/field'

export function CreateCommunityDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateCommunity()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const previewChroma = getCommunityChroma(name.trim() || 'kuaikan')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const cleanName = name.trim()
    if (cleanName.length < 2 || cleanName.length > 32) {
      setError('社群名称长度需在 2~32 个字符之间')
      return
    }
    create.mutate(
      {
        name: cleanName,
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: (created) => {
          setName('')
          setDescription('')
          onClose()
          const targetName = created.name ?? cleanName
          void navigate(`/c/${encodeURIComponent(targetName)}`)
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : '创建社群失败，请稍后重试')
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      testId="create-community-dialog"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          创建新社群
        </span>
      }
      description="围绕一个清晰主题建立讨论空间。创建后你将自动成为该社群的初代管理员，名称不可更改。"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 实时极光色系预览条 */}
        <div className="flex items-center justify-between rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className="h-6 w-6 rounded-lg shadow-md transition-all duration-500"
              style={{ background: previewChroma.gradient }}
            />
            <div>
              <p className="text-xs font-semibold text-foreground">
                专属极光色系：{previewChroma.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                系统将按社群名称自动生成和谐环境光晕
              </p>
            </div>
          </div>
          <span
            className="h-2.5 w-12 rounded-full"
            style={{ background: previewChroma.gradient }}
          />
        </div>

        <Field
          label="社群名称"
          htmlFor="create-comm-name"
          hint="2~32 个字符，会作为社群专属访问链接 /c/社群名"
        >
          <Input
            id="create-comm-name"
            data-testid="field-community-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：厨房实验、摄影与器材、前端周刊"
            maxLength={32}
            required
          />
        </Field>

        <Field
          label="社群简介（可选）"
          htmlFor="create-comm-desc"
          right={
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {description.length} / 500
            </span>
          }
        >
          <Textarea
            id="create-comm-desc"
            data-testid="field-community-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明这个社群讨论什么内容…"
            rows={3}
            maxLength={500}
          />
        </Field>

        {error && (
          <p
            data-testid="create-community-error"
            className="rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2.5 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            取消
          </Button>
          <Button
            type="submit"
            data-testid="btn-create-community-submit"
            disabled={create.isPending}
          >
            {create.isPending ? '创建中…' : '创建社群'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
