import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateCommunity } from '@/features/community/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

/**
 * 建社群弹窗。
 *
 * 用弹窗而不是独立路由：这是一次性的短表单（两个字段），
 * 占一个路由会让"返回"语义变复杂，也不值得被收藏/分享。
 *
 * 表单里**没有 slug 字段**——社群名就是标识，URL 由服务端规范化生成。
 * 让用户为一个自己不看的东西想一个全站唯一的 ASCII 字符串，是纯摩擦。
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
          navigate(`/c/${encodeURIComponent(community.name ?? name)}`)
        },
        onError: (err) => setError(authErrorMessage(err)),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="create-community-dialog"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="space-y-3">
          <CardTitle>建一个社群</CardTitle>
          <CardDescription>
            名称创建后不可修改——它会成为社群的地址（/c/名称）。
          </CardDescription>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">社群名（2~32 字符）</span>
              <input
                data-testid="field-community-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">
                简介（可选，最多 500 字）
              </span>
              <textarea
                data-testid="field-community-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>

            {error ? (
              <p className="text-[11px] text-danger" data-testid="create-community-error">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={create.isPending} data-testid="btn-create-community-submit">
                {create.isPending ? '创建中…' : '创建'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                取消
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
