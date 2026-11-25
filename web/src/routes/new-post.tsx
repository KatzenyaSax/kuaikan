import { Suspense, lazy, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  PenLine,
  Quote,
  Send,
} from 'lucide-react'

const AiComposeBar = lazy(() =>
  import('@/features/ai/ai-compose-bar').then((m) => ({ default: m.AiComposeBar })),
)
import { useCommunityDetail } from '@/features/community/api'
import { useCreatePost } from '@/features/content/api'
import { ApiError } from '@/shared/api/api-error'
import { getCommunityChroma } from '@/shared/theme/community-chroma'
import { LuminousIcon } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input, Textarea } from '@/shared/ui/field'
import { Segmented } from '@/shared/ui/segmented'

type StudioMode = 'split' | 'write' | 'preview'

const MAX_TITLE = 120
const MAX_BODY = 20000

const TOOLBAR_ITEMS = [
  { icon: Heading2, label: '二级标题', before: '\n## ', after: '\n', placeholder: '小节标题' },
  { icon: Bold, label: '加粗', before: '**', after: '**', placeholder: '加粗文字' },
  { icon: Italic, label: '斜体', before: '*', after: '*', placeholder: '斜体文字' },
  { icon: Quote, label: '引用', before: '\n> ', after: '\n', placeholder: '引用内容' },
  { icon: Code, label: '代码块', before: '\n```\n', after: '\n```\n', placeholder: 'code here' },
  { icon: List, label: '列表', before: '\n- ', after: '', placeholder: '列表项' },
  { icon: Link2, label: '链接', before: '[', after: '](https://)', placeholder: '链接文字' },
] as const

export function NewPostPage() {
  const { name } = useParams()
  const communityName = name ?? ''
  const navigate = useNavigate()

  const detail = useCommunityDetail(communityName)
  const createPost = useCreatePost()
  const chroma = getCommunityChroma(detail.data?.name ?? communityName)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<StudioMode>('split')
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const insertSnippet = (before: string, after = '', placeholder = '') => {
    const el = bodyRef.current
    if (!el) {
      setBody((prev) => `${prev}${before}${placeholder}${after}`)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = body.slice(start, end) || placeholder
    const next = body.slice(0, start) + before + selected + after + body.slice(end)
    setBody(next)
    window.requestAnimationFrame(() => {
      el.focus()
      const caretStart = start + before.length
      el.setSelectionRange(caretStart, caretStart + selected.length)
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const communityId = detail.data?.id
    if (!communityId) {
      setError('社群信息尚未加载完成，请稍后重试')
      return
    }
    const cleanTitle = title.trim()
    const cleanBody = body.trim()
    if (!cleanTitle) {
      setError('请输入帖子标题')
      return
    }
    if (!cleanBody) {
      setError('请输入帖子正文')
      return
    }

    createPost.mutate(
      { communityId, title: cleanTitle, body: cleanBody },
      {
        onSuccess: (created) => {
          const id = created.id
          if (id) {
            void navigate(`/c/${encodeURIComponent(communityName)}/p/${encodeURIComponent(id)}`)
          } else {
            void navigate(`/c/${encodeURIComponent(communityName)}`)
          }
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : '发帖失败，请确认已加入该社群')
        },
      },
    )
  }

  const titlePct = Math.min(100, (title.length / MAX_TITLE) * 100)
  const bodyPct = Math.min(100, (body.length / MAX_BODY) * 100)

  return (
    <div data-testid="new-post-page" className="mx-auto max-w-6xl space-y-5">
      {/* 顶栏：返回 + 工作室标题 + 视图模式切换 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            to={`/c/${encodeURIComponent(communityName)}`}
            className="glass-panel inline-flex h-10 w-10 items-center justify-center rounded-2xl text-secondary-foreground transition-colors hover:text-foreground"
            aria-label="返回社群"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <LuminousIcon size="md" gradient={chroma.gradient}>
            <PenLine className="h-5 w-5" />
          </LuminousIcon>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
              发布新帖
            </h1>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
              style={{ background: chroma.gradient }}
            >
              #{detail.data?.name ?? communityName}
            </span>
          </div>
        </div>

        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: '纯写作' },
            { value: 'split', label: '双栏预览' },
            { value: 'preview', label: '纯预览' },
          ]}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 标题卡 + 字数能量条 */}
        <Card padding="md" className="rounded-3xl space-y-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label htmlFor="new-post-title" className="font-semibold text-secondary-foreground">
              帖子标题
            </label>
            <span className="tabular-nums font-mono">
              {String(title.length)} / {String(MAX_TITLE)}
            </span>
          </div>
          <Input
            id="new-post-title"
            data-testid="field-post-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="起一个清晰、有吸引力的标题…"
            maxLength={MAX_TITLE}
            className="h-12 font-display text-base font-bold"
            required
          />
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${String(titlePct)}%`, background: chroma.gradient }}
            />
          </div>
        </Card>

        {/* 编辑 + 预览主画布 */}
        <div
          className={
            mode === 'split'
              ? 'grid gap-4 lg:grid-cols-2'
              : 'grid grid-cols-1'
          }
        >
          {/* 写作面板 */}
          {mode !== 'preview' && (
            <Card padding="none" className="flex flex-col overflow-hidden rounded-3xl">
              {/* Markdown 工具条 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1">
                  {TOOLBAR_ITEMS.map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      title={tool.label}
                      onClick={() => insertSnippet(tool.before, tool.after, tool.placeholder)}
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-primary"
                    >
                      <tool.icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                <span className="tabular-nums font-mono text-[11px] text-muted-foreground">
                  {String(body.length)} / {String(MAX_BODY)}
                </span>
              </div>

              <div className="flex-1 space-y-3 p-4">
                <Suspense fallback={null}>
                  <AiComposeBar
                    variant="post"
                    draft={body.trim() ? body : title}
                    onReplace={(text) => setBody(text)}
                    onInsert={(text) => setBody((prev) => (prev ? `${prev}\n\n${text}` : text))}
                  />
                </Suspense>
                <Textarea
                  ref={bodyRef}
                  data-testid="field-post-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="在这里用 Markdown 撰写你的深度见解、经验复盘或分享…"
                  rows={16}
                  maxLength={MAX_BODY}
                  className="min-h-[380px] border-none bg-transparent p-0 font-sans text-sm leading-relaxed focus:ring-0"
                  required
                />
              </div>

              <div className="h-1 w-full bg-[var(--bg-input)]">
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${String(bodyPct)}%`, background: chroma.gradient }}
                />
              </div>
            </Card>
          )}

          {/* 实时渲染预览面板 */}
          {mode !== 'write' && (
            <Card padding="none" className="flex flex-col overflow-hidden rounded-3xl">
              <div className="flex items-center justify-between border-b border-[var(--border-glass)] bg-[var(--bg-input)] px-4 py-2.5 text-xs font-semibold text-secondary-foreground">
                <span className="inline-flex items-center gap-1.5">
                  {mode === 'split' ? (
                    <Columns2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-primary" />
                  )}
                  实时预览
                </span>
              </div>

              <div className="min-h-[380px] flex-1 overflow-y-auto p-6">
                {title.trim() && (
                  <h2 className="mb-4 border-b border-[var(--border-glass)] pb-3 font-display text-2xl font-extrabold text-foreground">
                    {title}
                  </h2>
                )}
                {body.trim() ? (
                  <div className="prose-aurora">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    左侧输入 Markdown 正文，这里将实时呈现精致的沉浸阅读效果…
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* 错误与底部发布栏 */}
        {error && (
          <p
            data-testid="new-post-error"
            className="rounded-2xl border border-danger/35 bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-medium text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Link
            to={`/c/${encodeURIComponent(communityName)}`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            放弃草稿并返回
          </Link>
          <Button
            type="submit"
            size="lg"
            data-testid="btn-submit-post"
            disabled={createPost.isPending}
          >
            <Send className="h-4 w-4" />
            {createPost.isPending ? '正在发布…' : '发布帖子'}
          </Button>
        </div>
      </form>
    </div>
  )
}
