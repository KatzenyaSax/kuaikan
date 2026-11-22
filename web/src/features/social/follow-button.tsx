import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '@/features/auth/session'
import {
  useFollowStates,
  useFollowUser,
  useUnfollowUser,
  type FollowState,
} from '@/features/social/api'
import { ApiError } from '@/shared/api/api-error'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'
import { cn } from '@/shared/lib/cn'

/**
 * 关注按钮（P5.5.1）。
 *
 * ## 三态
 *
 * ```
 *   未关注              → 「关注」（实心蓝胶囊，一屏一个主操作）
 *   已关注              → 「已关注」（淡灰胶囊），hover 变成「取消关注」
 *   互相关注            → 「互相关注」（淡灰胶囊），hover 同上
 * ```
 *
 * hover 文案用 `onMouseEnter` + 本地 state 切换（而不是 CSS `group-hover`）：
 * 文案要**同时**驱动 title 与配色，CSS 切不了文本节点。
 * 只在单个按钮上维护一个 boolean，且只在本组件内——列表里几十个按钮的状态
 * 互不影响，React 在 hover 切换时也只重渲染这一个节点。
 *
 * ## 游客与本人
 *
 * - 游客：渲染「关注」，点击直接跳 `/login`（带上当前路径，登录后能回来）。
 *   **不发 states 请求**——未登录调它必然 401，白白制造一次续期/登出噪音。
 * - 本人：不渲染（关注自己没有意义），也**不发 states 请求**。
 *
 * ## 批量状态（P5.5.2 列表复用）
 *
 * 关注/粉丝列表会用一次 `useFollowStates(allIds)` 拿整页状态，然后逐项传 `state`。
 * 传了 `state` 就**不再单查**，否则列表里 N 个按钮就是 N 次请求。
 */
export function FollowButton({
  userId,
  state: stateProp,
  size = 'sm',
  className,
  testId = 'btn-follow',
}: {
  userId: string | undefined
  /**
   * 外部已批量查好的关注状态。
   *
   * 传了就禁用组件内部的单查（避免列表 N+1）；不传时沿用单查。
   */
  state?: FollowState
  size?: 'sm' | 'md'
  className?: string
  /** 同一页面出现多个关注按钮时可以用不同的 testid 区分（默认 btn-follow） */
  testId?: string
}) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const me = useSession((s) => s.user)
  const authed = status === 'authenticated'
  const [hovered, setHovered] = useState(false)

  const isSelf = Boolean(me && me.userId === userId)
  // 内部单查只在「未传批量状态 + 已登录 + 不是本人」时才发；
  // 本人也查一次是最容易漏掉的浪费（一进自己主页就白跑一次 states）
  const states = useFollowStates(
    [userId],
    authed && Boolean(userId) && !isSelf && stateProp === undefined,
  )
  const follow = useFollowUser()
  const unfollow = useUnfollowUser()

  // 本人不渲染。userId 缺失（页面还在解析参数）也不渲染，避免闪一个"关注"
  if (!userId || isSelf) {
    return null
  }

  // 优先级：外部批量状态 > 组件内部单查结果 > 未关注
  const fetched = states.data?.[userId]
  const state: FollowState = stateProp ?? fetched ?? { following: false, followedBy: false }
  const pending = follow.isPending || unfollow.isPending
  const mutual = state.following && state.followedBy

  const onFollow = () => {
    if (!authed) {
      // 与 RequireAuth 同一套返回路径：登录后回到当前页，而不是被丢回首页
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      navigate(`/login?returnTo=${returnTo}`)
      return
    }
    if (state.following) {
      unfollow.mutate(userId, {
        // 40210（不能关注自己）/ 40211（已达上限）是 HTTP 200 + code，client 会抛 ApiError
        onError: (err) => {
          toast(err instanceof ApiError ? err.message : '取消关注失败')
        },
      })
      return
    }
    follow.mutate(userId, {
      onError: (err) => {
        toast(err instanceof ApiError ? err.message : '关注失败')
      },
    })
  }

  const label = pending
    ? '处理中…'
    : !state.following
      ? '关注'
      : hovered
        ? '取消关注'
        : mutual
          ? '互相关注'
          : '已关注'

  return (
    <Button
      variant={state.following ? 'outline' : 'primary'}
      size={size}
      onClick={onFollow}
      disabled={pending}
      onMouseEnter={() => {
        setHovered(true)
      }}
      onMouseLeave={() => {
        setHovered(false)
      }}
      onFocus={() => {
        setHovered(true)
      }}
      onBlur={() => {
        setHovered(false)
      }}
      className={cn(
        // 已关注态在 hover 时收紧成"取消关注"的危险色，给出明确的降级预期。
        // 用淡红底而不是深色/描边：取消关注是「降级」动作，不该看起来和主操作一样重。
        state.following && hovered && 'text-danger hover:bg-danger/10',
        className,
      )}
      data-testid={testId}
      data-following={state.following ? 'true' : 'false'}
      data-mutual={mutual ? 'true' : 'false'}
      title={
        !authed
          ? '登录后可以关注'
          : state.following
            ? '取消关注'
            : state.followedBy
              ? // 未关注但对方关注了我：这是「回关」，提示要比干巴巴的「关注」更有信息量
                '对方关注了你，回关'
              : '关注'
      }
    >
      {label}
    </Button>
  )
}
