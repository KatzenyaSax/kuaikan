import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { useCreatePost } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

/** 与后端 CreatePostRequest 的 @Size 是同一组数字，改一处必须改两处 */
const MAX_TITLE = 120
const MAX_BODY = 20000

export function NewPostPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const community = useCommunityDetail(name)
  const create = useCreatePost()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (community.isPending) return <Skeleton className="mx-auto h-40 max-w-2xl" />

  if (community.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <p className="text-sm text-danger">{authErrorMessage(community.error)}</p>
          <Link to="/" className="mt-3 inline-block text-[11px] underline">返回社群列表</Link>
        </Card>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate(
      { communityId: community.data.id ?? '', title, body },
      {
        onSuccess: (post) => navigate(`/c/${encodeURIComponent(name ?? '')}/p/${post.id ?? ''}`),
        // 非成员（41004）、社群不存在（41001）、下游不可用（50300）都走这里，
        // 文案由错误码表给出，这里不重复判断
        onError: (err) => setError(authErrorMessage(err)),
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="new-post-page">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">发帖到 {community.data.name}</h1>
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="text-[11px] text-muted-foreground underline"
        >
          取消
        </Link>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Card className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              标题（最多 {MAX_TITLE} 字）
            </span>
            <input
              data-testid="field-post-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">
              正文（最多 {MAX_BODY} 字）
            </span>
            <textarea
              data-testid="field-post-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              rows={14}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <CardDescription>正文是纯文本，换行会保留；不支持 Markdown。</CardDescription>
        </Card>

        {error ? (
          <p className="text-[11px] text-danger" data-testid="new-post-error">{error}</p>
        ) : null}

        <Button type="submit" disabled={create.isPending} data-testid="btn-submit-post">
          {create.isPending ? '发布中…' : '发布'}
        </Button>
      </form>
    </div>
  )
}
