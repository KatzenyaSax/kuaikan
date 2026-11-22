import { useSession } from '@/features/auth/session'
import { buttonClass } from '@/shared/ui/button'
import { cn } from '@/shared/lib/cn'
import {
  useToggleFavorite,
  useToggleLike,
  type InteractionState,
} from '@/features/interaction/api'

/**
 * 点赞 / 收藏按钮。
 *
 * 计数为 0 时不显示数字，只显示图标 + 文字（P2 定的规则：0 会像坏了）。
 * 游客看到的是灰掉的按钮，点不动——不弹登录，因为浏览时点它们是次要动作。
 *
 * 状态从父组件传下来的 states 里取：一屏的 states 只查一次，
 * 每个按钮各查一次就等于把批量接口的意义抹掉了。
 *
 * ## 形态：胶囊，不是纯文字
 *
 * 两个按钮都是**胶囊**（`rounded-full` + hover 淡底）。纯文字在密集列表里
 * 分不清"这里能点"和"这里只是标签"；胶囊给了确定的点击形状。
 * 激活态用浅蓝底 + 蓝字（`--color-primary-soft`），而不是实心蓝——
 * 实心蓝是主操作（发表、关注）的专属，点赞不该抢它。
 *
 * `compact` 给评论区用：评论行的次级动作只有 12px 字、28px 高，
 * 默认 32px 的胶囊在那里会顶出一条不对齐的行。
 */
export function LikeButton({
  targetType,
  targetId,
  count,
  states,
  compact = false,
}: {
  targetType: 'post' | 'comment'
  targetId: string
  count: number
  states: InteractionState[] | undefined
  /** 评论区行内的小号胶囊 */
  compact?: boolean
}) {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const toggle = useToggleLike()
  const liked = states?.find(
    (s) => s.targetType === targetType && s.targetId === targetId,
  )?.liked ?? false

  return (
    <button
      type="button"
      disabled={!authed || toggle.isPending}
      onClick={() => toggle.mutate({ liked, body: { targetType, targetId } })}
      className={buttonClass({
        variant: 'ghost',
        size: 'sm',
        className: cn(
          pillClass(compact),
          liked && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
        ),
      })}
      data-testid={liked ? 'btn-liked' : 'btn-like'}
      title={authed ? (liked ? '取消点赞' : '点赞') : '登录后可以点赞'}
    >
      {liked ? '已赞' : '赞'}
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </button>
  )
}

export function FavoriteButton({
  targetId,
  count,
  states,
  compact = false,
}: {
  targetId: string
  count: number
  states: InteractionState[] | undefined
  compact?: boolean
}) {
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const toggle = useToggleFavorite()
  const favorited = states?.find(
    (s) => s.targetType === 'post' && s.targetId === targetId,
  )?.favorited ?? false

  return (
    <button
      type="button"
      disabled={!authed || toggle.isPending}
      onClick={() => toggle.mutate({ favorited, body: { targetType: 'post', targetId } })}
      className={buttonClass({
        variant: 'ghost',
        size: 'sm',
        className: cn(
          pillClass(compact),
          favorited &&
            'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
        ),
      })}
      data-testid={favorited ? 'btn-favorited' : 'btn-favorite'}
      title={authed ? (favorited ? '取消收藏' : '收藏') : '登录后可以收藏'}
    >
      {favorited ? '已收藏' : '收藏'}
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </button>
  )
}

/** 小号胶囊：评论行内 28px，帖子详情互动条直接用默认 32px */
function pillClass(compact: boolean): string {
  return compact ? 'h-7 gap-1 px-2 text-caption' : 'gap-1.5 px-3'
}
