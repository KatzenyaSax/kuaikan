import { useState } from 'react'
import { ShieldBan } from 'lucide-react'
import { useBanCommunityMember } from '@/features/community/api'
import { Dialog } from '@/features/community/dialog'
import { ApiError } from '@/shared/api/api-error'
import { Button } from '@/shared/ui/button'
import { Field, Textarea } from '@/shared/ui/field'
import { cn } from '@/shared/lib/cn'

const DURATIONS: ReadonlyArray<{ key: string; label: string; days: number | null }> = [
  { key: '1', label: '1 天', days: 1 },
  { key: '7', label: '7 天', days: 7 },
  { key: '30', label: '30 天', days: 30 },
  { key: 'permanent', label: '永久', days: null },
]

export function BanMemberDialog({
  open,
  onClose,
  communityName,
  targetUserId,
  targetNickname,
  onBanned,
}: {
  open: boolean
  onClose: () => void
  communityName: string
  targetUserId: string
  targetNickname: string
  onBanned?: () => void
}) {
  const ban = useBanCommunityMember(communityName)
  const [durationKey, setDurationKey] = useState<string>('7')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const chosen = DURATIONS.find((d) => d.key === durationKey) ?? DURATIONS[1]
    const cleanReason = reason.trim()

    ban.mutate(
      {
        userId: targetUserId,
        ...(chosen && chosen.days !== null ? { durationDays: chosen.days } : {}),
        ...(cleanReason ? { reason: cleanReason } : {}),
      },
      {
        onSuccess: () => {
          setReason('')
          setDurationKey('7')
          onBanned?.()
          onClose()
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : '封禁操作失败，请稍后重试')
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      testId="ban-member-dialog"
      title={
        <span className="inline-flex items-center gap-2 text-danger">
          <ShieldBan className="h-4 w-4" />
          封禁成员：{targetNickname}
        </span>
      }
      description="被封禁用户将被移出本社群并在封禁期间无法重新加入、发帖或评论，但仍可浏览公开内容。"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-secondary-foreground">封禁时长</p>
          <div className="grid grid-cols-4 gap-2">
            {DURATIONS.map((d) => {
              const active = d.key === durationKey
              return (
                <button
                  key={d.key}
                  type="button"
                  data-testid={`ban-duration-${d.key}`}
                  onClick={() => setDurationKey(d.key)}
                  className={cn(
                    'cursor-pointer rounded-xl border py-2 text-xs font-semibold transition-all',
                    active
                      ? 'border-danger/60 bg-danger text-white shadow-md'
                      : 'border-[var(--border-glass-strong)] bg-[var(--bg-input)] text-secondary-foreground hover:text-foreground',
                  )}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>

        <Field
          label="封禁原因（可选，对外可见）"
          htmlFor="ban-reason-input"
          right={
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {reason.length} / 200
            </span>
          }
        >
          <Textarea
            id="ban-reason-input"
            data-testid="field-ban-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：发布广告、恶意灌水…"
            maxLength={200}
            rows={3}
          />
        </Field>

        {error && (
          <p
            data-testid="ban-error"
            className="rounded-xl border border-danger/35 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs font-medium text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2.5 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={ban.isPending}>
            取消
          </Button>
          <Button
            type="submit"
            variant="danger"
            data-testid="btn-submit-ban"
            disabled={ban.isPending}
          >
            {ban.isPending ? '提交中…' : '确认封禁'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
