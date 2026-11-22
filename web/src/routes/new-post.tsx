import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCommunityDetail } from '@/features/community/api'
import { useCreatePost } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/field'
import { Group, GroupFooter, GroupHeader } from '@/shared/ui/group'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'

/** 与后端 CreatePostRequest 的 @Size 是同一组数字，改一处必须改两处 */
const MAX_TITLE = 120
const MAX_BODY = 20000

/** 页面外壳：浅底 + 980 栏宽，表单列 680（和阅读栏宽一致，视线不横向跳） */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] bg-surface" data-testid="new-post-page">
      <div className="mx-auto w-full max-w-[980px] px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[680px]">{children}</div>
      </div>
    </div>
  )
}

/** 字段标签：caption 灰字，和输入框左边缘对齐 */
function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-caption text-muted-foreground">{children}</span>
}

/**
 * 发帖页。
 *
 * 一页只做一件事：**把标题和正文写下来**。所以：
 *   - 大标题在页内（产品页风格），副标题带上要发到哪个社群 —— 不用再问一次
 *   - 表单是 inset grouped：浅底上两块白面，标题一块、正文一块
 *   - 不摆工具栏、不加预览 tab：没有第二件事就不会分心
 */
export function NewPostPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const community = useCommunityDetail(name)
  const create = useCreatePost()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (community.isPending) {
    return (
      <Page>
        <Skeleton className="mb-3 h-9 w-2/3" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
      </Page>
    )
  }

  if (community.isError) {
    return (
      <Page>
        <p className="m-0 text-body text-danger">{authErrorMessage(community.error)}</p>
        <Link
          to="/"
          className="mt-4 inline-block text-aux text-muted-foreground hover:text-foreground hover:underline"
        >
          ← 返回首页
        </Link>
      </Page>
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
    <Page>
      <header className="mb-9 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-title">写帖子</h1>
          <p className="m-0 mt-2 text-read text-muted-foreground">
            发到 <span className="text-foreground">{community.data.name}</span>
          </p>
        </div>
        <Link
          to={`/c/${encodeURIComponent(name ?? '')}`}
          className="shrink-0 text-aux text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground hover:underline"
        >
          取消
        </Link>
      </header>

      <form onSubmit={submit} noValidate>
        <GroupHeader className="px-1">标题</GroupHeader>
        <Group className="p-4">
          <label className="block">
            <Label>一句话说清楚这篇帖子在讲什么（最多 {MAX_TITLE} 字）</Label>
            <Input
              data-testid="field-post-title"
              className="h-11 text-read"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
            />
          </label>
        </Group>

        <GroupHeader className="mt-9 px-1">正文</GroupHeader>
        <Group className="p-4">
          <label className="block">
            <Label>最多 {MAX_BODY} 字</Label>
            <Textarea
              data-testid="field-post-body"
              className="min-h-[18rem]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              rows={14}
            />
          </label>
          <GroupFooter className="px-0">正文是纯文本，换行会保留；不支持 Markdown。</GroupFooter>
        </Group>

        {error ? (
          <p className="m-0 mt-5 text-aux text-danger" data-testid="new-post-error">
            {error}
          </p>
        ) : null}

        <div className="mt-9 flex items-center gap-4">
          <Button
            type="submit"
            size="lg"
            disabled={create.isPending}
            data-testid="btn-submit-post"
          >
            {create.isPending ? '发布中…' : '发布'}
          </Button>
          <span className="text-caption text-faint">发布后直接跳到帖子页。</span>
        </div>
      </form>
    </Page>
  )
}
