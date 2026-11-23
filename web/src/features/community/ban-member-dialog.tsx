import { useState } from 'react'
import { useBanCommunityMember, type BanCommunityMemberBody } from '@/features/community/api'
import { Modal } from '@/features/community/dialog'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/field'
import { toast } from '@/shared/ui/toast'
import { cn } from '@/shared/lib/cn'

/**
 * 封禁时长：只给四个固定选项。
 *
 * 与后端白名单是**同一组值**（`durationDays ∈ {null, 1, 7, 30}`）：
 * 允许任意天数意味着"永久"与"100 年"两种表达同时存在，
 * 而封禁名单要按它排序、要按它生成文案。
 *
 * `null` = 永久。提交时**省略**这个字段而不是传 null ——
 * 生成的 wire 类型里它是 `durationDays?: number`（不可空），
 * 而 Jackson 对缺失字段正是按 null 处理。
 */
const DURATIONS: Array<{ value: number | null; label: string; testId: string }> = [
  { value: 1, label: '1 天', testId: 'ban-duration-1' },
  { value: 7, label: '7 天', testId: 'ban-duration-7' },
  { value: 30, label: '30 天', testId: 'ban-duration-30' },
  { value: null, label: '永久', testId: 'ban-duration-forever' },
]

/** 与后端 @Size(max = 200) 是同一个数字 */
const MAX_REASON = 200

/**
 * 封禁弹窗。**三处共用**：管理台的成员列表、帖子详情、评论区。
 *
 * 共用而不是各写一份的理由不是省代码，而是**一致性**：
 * 同一个管理员在三个地方封同一个人，"可选时长"和"原因上限"必须完全一样，
 * 否则他会以为自己在评论区只能封 1 天。
 *
 * 只在需要时挂载（调用方 `{target ? <BanMemberDialog/> : null}`），
 * 所以没有 `open` 属性，也没有内部残留状态的问题。
 */
export function BanMemberDialog({
  communityName,
  targetUserId,
  targetNickname,
  onClose,
}: {
  communityName: string | undefined
  targetUserId: string
  targetNickname: string | undefined
  onClose: () => void
}) {
  const ban = useBanCommunityMember(communityName)
  const [days, setDays] = useState<number | null>(7)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    const trimmed = reason.trim()
    // exactOptionalPropertyTypes：没填原因 / 永久封禁都**省略**对应字段
    const body: BanCommunityMemberBody = {
      userId: targetUserId,
      ...(days === null ? {} : { durationDays: days }),
      ...(trimmed === '' ? {} : { reason: trimmed }),
    }
    ban.mutate(body, {
      onSuccess: () => {
        toast(days === null ? '已永久封禁' : `已封禁 ${String(days)} 天`)
        onClose()
      },
      // 41008（封禁管理员）、41003（不是成员）等一律显示后端原话
      onError: (err) => setError(authErrorMessage(err)),
    })
  }

  return (
    <Modal
      title="封禁用户"
      description={
        <>
          封禁后 ta 将无法加入、发帖或评论，直到封禁结束。
          {targetNickname ? (
            <>
              对象：<span className="font-medium text-foreground">{targetNickname}</span>
            </>
          ) : null}
        </>
      }
      onClose={onClose}
      testId="ban-member-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={ban.isPending}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={ban.isPending}
            data-testid="btn-submit-ban"
          >
            {ban.isPending ? '处理中…' : '确认封禁'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="mb-2 block text-caption text-muted-foreground">封禁时长</span>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => {
              const active = d.value === days
              return (
                <button
                  key={d.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDays(d.value)}
                  className={cn(
                    'h-8 rounded-full px-4 text-aux transition-colors duration-[var(--duration-fast)]',
                    active
                      ? 'bg-foreground font-medium text-white'
                      : 'bg-fill text-muted-foreground hover:bg-fill-strong hover:text-foreground',
                  )}
                  data-testid={d.testId}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="mb-2 block text-caption text-muted-foreground">
            封禁原因（可选，最多 {MAX_REASON} 字）
          </span>
          <Textarea
            data-testid="field-ban-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REASON}
            rows={3}
            placeholder="会展示给被封禁的用户，例如：发布广告"
          />
          {/* 原因是对外可见的文案：41006 的 message 会把它原样带给被封禁的人 */}
          <span className="mt-1.5 block text-caption text-faint">
            这段文字会出现在 ta 尝试加入或发言时的提示里。
          </span>
        </label>

        {error ? (
          <p className="m-0 text-aux text-danger" data-testid="ban-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
