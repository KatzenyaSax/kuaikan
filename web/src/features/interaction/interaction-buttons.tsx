import { useSession } from '@/features/auth/session'
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
 */
export function LikeButton({
  targetType,
  targetId,
  count,
  states,
}: {
  targetType: 'post' | 'comment'
  targetId: string
  count: number
  states: InteractionState[] | undefined
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
      className={
        'text-[11px] transition-colors disabled:opacity-50 ' +
        (liked ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
      }
      data-testid={liked ? 'btn-liked' : 'btn-like'}
      title={authed ? (liked ? '取消点赞' : '点赞') : '登录后可以点赞'}
    >
      {liked ? '已赞' : '赞'}
      {count > 0 ? ` ${count}` : ''}
    </button>
  )
}

export function FavoriteButton({
  targetId,
  count,
  states,
}: {
  targetId: string
  count: number
  states: InteractionState[] | undefined
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
      className={
        'text-[11px] transition-colors disabled:opacity-50 ' +
        (favorited ? 'text-primary' : 'text-muted-foreground hover:text-foreground')
      }
      data-testid={favorited ? 'btn-favorited' : 'btn-favorite'}
      title={authed ? (favorited ? '取消收藏' : '收藏') : '登录后可以收藏'}
    >
      {favorited ? '已收藏' : '收藏'}
      {count > 0 ? ` ${count}` : ''}
    </button>
  )
}
