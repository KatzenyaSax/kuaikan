import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateCommunity } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/field'
import { toast } from '@/shared/ui/toast'

/**
 * 建社群弹窗。
 *
 * 用弹窗而不是独立路由：一次性短表单（两个字段），占一个路由会让"返回"语义变复杂，
 * 也不值得被收藏/分享。
 *
 * 表单里**没有 slug 字段** —— 社群名就是标识，URL 由服务端规范化生成。
 */
export function CreateCommunityDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateCommunity()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    // exactOptionalPropertyTypes: 空简介要**省略 key**，不能传 undefined
    const body = description.trim() === '' ? { name } : { name, description }
    create.mutate(body, {
      onSuccess: (community) => {
        onClose()
        toast('社群已创建')
        navigate(`/c/${encodeURIComponent(community.name ?? name)}`)
      },
      onError: (err) => setError(authErrorMessage(err)),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.42)] p-4"
      onClick={onClose}
      data-testid="create-community-dialog"
      style={{ animation: 'fade-in 150ms cubic-bezier(0.2,0.8,0.2,1) both' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[27rem] rounded-[var(--radius-xl)] bg-background p-7"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <h2 className="m-0 text-sub font-semibold">建一个社群</h2>
        <p className="m-0 mb-6 mt-1.5 text-aux text-muted-foreground">
          名称创建后不可修改 —— 它会成为社群的地址（/c/名称）。
        </p>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-caption text-faint">社群名（2~32 字符）</span>
            <Input
              data-testid="field-community-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-caption text-faint">简介（可选，最多 500 字）</span>
            <Textarea
              data-testid="field-community-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </label>

          {error ? (
            <p className="m-0 text-aux text-danger" data-testid="create-community-error">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={create.isPending}
              data-testid="btn-create-community-submit"
            >
              {create.isPending ? '创建中…' : '创建'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
