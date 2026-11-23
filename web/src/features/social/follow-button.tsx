import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Check, UserPlus } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useFollowUser, useUnfollowUser } from '@/features/social/api'
import { cn } from '@/shared/lib/cn'

export function FollowButton({
  targetUserId,
  following,
  followedBy = false,
  size = 'sm',
  testId = 'btn-follow',
  className,
}: {
  targetUserId: string
  following: boolean
  followedBy?: boolean
  size?: 'sm' | 'md'
  testId?: string
  className?: string
}) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const meId = useSession((s) => s.user?.userId)
  const follow = useFollowUser()
  const unfollow = useUnfollowUser()

  if (meId && meId === targetUserId) return null

  const busy = follow.isPending || unfollow.isPending
  const isMutual = following && followedBy

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (status !== 'authenticated') {
      void navigate('/login')
      return
    }
    if (following) {
      unfollow.mutate(targetUserId)
    } else {
      follow.mutate(targetUserId)
    }
  }

  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      type="button"
      disabled={busy}
      data-testid={testId}
      data-following={String(following)}
      onClick={handleClick}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-200 select-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
        following
          ? 'border border-[var(--border-glass-strong)] bg-[var(--bg-surface)] text-secondary-foreground hover:border-danger/45 hover:bg-[var(--color-danger-soft)] hover:text-danger'
          : 'btn-aurora border border-white/20 text-white',
        className,
      )}
    >
      {isMutual ? (
        <>
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span>互相关注</span>
        </>
      ) : following ? (
        <>
          <Check className="h-3.5 w-3.5" />
          <span>已关注</span>
        </>
      ) : (
        <>
          <UserPlus className="h-3.5 w-3.5" />
          <span>关注</span>
        </>
      )}
    </motion.button>
  )
}
