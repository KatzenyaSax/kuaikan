import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Heart, Star } from 'lucide-react'
import { useSession } from '@/features/auth/session'
import { useToggleFavorite, useToggleLike } from '@/features/interaction/api'
import { cn } from '@/shared/lib/cn'

const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

function ParticleBurst({ burstKey, color }: { burstKey: number; color: string }) {
  return (
    <AnimatePresence>
      {burstKey > 0 && (
        <span
          key={burstKey}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {SPARK_ANGLES.map((deg) => {
            const rad = (deg * Math.PI) / 180
            const x = Math.cos(rad) * 24
            const y = Math.sin(rad) * 24
            return (
              <motion.span
                key={deg}
                initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                animate={{ x, y, scale: 0, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
              />
            )
          })}
          <motion.span
            initial={{ scale: 0.4, opacity: 0.85 }}
            animate={{ scale: 2.1, opacity: 0 }}
            transition={{ duration: 0.48, ease: 'easeOut' }}
            className="absolute h-6 w-6 rounded-full border-2"
            style={{ borderColor: color }}
          />
        </span>
      )}
    </AnimatePresence>
  )
}

export function LikeButton({
  targetType,
  targetId,
  liked,
  count,
  compact = false,
}: {
  targetType: 'POST' | 'COMMENT'
  targetId: string
  liked: boolean
  count: number
  compact?: boolean
}) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const toggle = useToggleLike()
  const [burstKey, setBurstKey] = useState(0)

  const handleClick = () => {
    if (status !== 'authenticated') {
      void navigate('/login')
      return
    }
    if (!liked) {
      setBurstKey((k) => k + 1)
    }
    toggle.mutate({
      liked,
      body: { targetType, targetId },
    })
  }

  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      type="button"
      disabled={toggle.isPending}
      data-testid={liked ? 'btn-liked' : 'btn-like'}
      aria-pressed={liked}
      onClick={handleClick}
      className={cn(
        'relative inline-flex cursor-pointer items-center gap-1.5 rounded-xl border font-semibold transition-all duration-200 select-none disabled:opacity-60',
        compact ? 'h-7 px-2.5 text-xs' : 'h-10 px-4 text-sm',
        liked
          ? 'border-[#FB7185]/50 bg-[#FB7185]/16 text-[#FB7185] shadow-[0_0_20px_-6px_rgba(251,113,133,0.65)]'
          : 'border-[var(--border-glass-strong)] bg-[var(--bg-surface)] text-secondary-foreground hover:border-[#FB7185]/45 hover:text-[#FB7185]',
      )}
    >
      <ParticleBurst burstKey={burstKey} color="#FB7185" />
      <motion.span
        animate={liked ? { scale: [1, 1.35, 1] } : { scale: 1 }}
        transition={{ duration: 0.32 }}
        className="inline-flex"
      >
        <Heart className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4', liked && 'fill-current')} />
      </motion.span>
      <span className="tabular-nums">{String(count)}</span>
    </motion.button>
  )
}

export function FavoriteButton({
  targetId,
  favorited,
  count,
}: {
  targetId: string
  favorited: boolean
  count: number
}) {
  const navigate = useNavigate()
  const status = useSession((s) => s.status)
  const toggle = useToggleFavorite()
  const [burstKey, setBurstKey] = useState(0)

  const handleClick = () => {
    if (status !== 'authenticated') {
      void navigate('/login')
      return
    }
    if (!favorited) {
      setBurstKey((k) => k + 1)
    }
    toggle.mutate({
      favorited,
      body: { targetType: 'POST', targetId },
    })
  }

  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      type="button"
      disabled={toggle.isPending}
      data-testid={favorited ? 'btn-favorited' : 'btn-favorite'}
      aria-pressed={favorited}
      onClick={handleClick}
      className={cn(
        'relative inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-all duration-200 select-none disabled:opacity-60',
        favorited
          ? 'border-[#FBBF24]/50 bg-[#FBBF24]/16 text-[#FBBF24] shadow-[0_0_20px_-6px_rgba(251,191,36,0.65)]'
          : 'border-[var(--border-glass-strong)] bg-[var(--bg-surface)] text-secondary-foreground hover:border-[#FBBF24]/45 hover:text-[#FBBF24]',
      )}
    >
      <ParticleBurst burstKey={burstKey} color="#FBBF24" />
      <motion.span
        animate={favorited ? { scale: [1, 1.35, 1], rotate: [0, 18, 0] } : { scale: 1 }}
        transition={{ duration: 0.36 }}
        className="inline-flex"
      >
        <Star className={cn('h-4 w-4', favorited && 'fill-current')} />
      </motion.span>
      <span className="tabular-nums">{String(count)}</span>
    </motion.button>
  )
}
