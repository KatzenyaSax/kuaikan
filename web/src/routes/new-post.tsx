import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { useCreatePost } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/field'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'

/** 与后端 CreatePostRequest 的 @Size 是同一组数字，改一处必须改两处 */
const MAX_TITLE = 120
const MAX_BODY = 20000

/**
 * 发帖页。
 *
 * 单栏、窄容器、没有卡片：这是一张"写作纸"，任何边框和装饰都在抢注意力。
 */
export function NewPostPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const community = useCommunityDetail(name)
  const create = useCreatePost()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (community.isPending) return <Skeleton className="mx-auto mt-12 h-40 max-w-[40rem]" />

  if (community.isError) {
    return (
      <div className="mx-auto max-w-[40rem] px-6 pt-12">
        <p className="text-body text-danger">{authErrorMessage(community.error)}</p>
        <Link to="/" className="mt-3 inline-block text-aux underline">
          返回首页
        </Link>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate(
      { communityId: community.data.id ?? '', title, body },
      {
        onSuccess: (post) => {
          toast('已发布')
          navigate(`/c/${encodeURIComponent(name ?? '')}/p/${post.id ?? ''}`)
        },
        // 非成员（41004）、社群不存在（41001）、下游不可用（50300）都走这里，
        // 文案由错误码表给出，这里不重复判断
        onError: (err) => setError(authErrorMessage(err)),
      },
    )
  }

  return (
    <div className="mx-auto max-w-[40rem] px-6 pb-24 pt-12" data-testid="new-post-page">
      <div className="mb-7 flex items-baseline justify-between">
        <h1 className="m-0 text-title font-[640]">发到 {community.data.name}</h1>
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="text-aux text-muted-foreground hover:underline"
        >
          取消
        </Link>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-caption text-faint">标题（最多 {MAX_TITLE} 字）</span>
          <Input
            data-testid="field-post-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-caption text-faint">正文（最多 {MAX_BODY} 字）</span>
          <Textarea
            data-testid="field-post-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_BODY}
            rows={14}
          />
        </label>
        <p className="m-0 text-caption text-faint">
          正文是纯文本，换行会保留；不支持 Markdown。
        </p>

        {error ? (
          <p className="m-0 text-aux text-danger" data-testid="new-post-error">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={create.isPending} data-testid="btn-submit-post">
          {create.isPending ? '发布中…' : '发布'}
        </Button>
      </form>
    </div>
  )
}
