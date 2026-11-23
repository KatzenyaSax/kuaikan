import { useTheme } from '@/shared/theme/theme-store'

/**
 * 全站环境极光画布（GPU 合成层，零布局重排）。
 *
 * 响应双主题（暗夜极光 / 冰晶琉璃）与当前社群动态色系（--aurora-1/2/3），
 * 通过平滑过渡色相，让每次切换社群都像步入不同氛围的玻璃展厅。
 */
export function AuroraBackdrop() {
  const mode = useTheme((s) => s.mode)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none"
    >
      {/* 极光主光球（左上） */}
      <div
        className="animate-aurora-1 absolute -top-[18vh] -left-[12vw] h-[62vh] w-[58vw] rounded-full blur-[110px] transition-colors duration-1000"
        style={{
          background:
            'radial-gradient(circle at 35% 35%, var(--aurora-1), transparent 72%)',
          opacity: 'var(--aurora-orb-opacity)',
        }}
      />

      {/* 极光副光球（右上） */}
      <div
        className="animate-aurora-2 absolute top-[8vh] -right-[14vw] h-[56vh] w-[52vw] rounded-full blur-[120px] transition-colors duration-1000"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, var(--aurora-2), transparent 70%)',
          opacity: 'var(--aurora-orb-opacity)',
        }}
      />

      {/* 极光底光球（中下） */}
      <div
        className="animate-aurora-3 absolute -bottom-[22vh] left-[22vw] h-[52vh] w-[56vw] rounded-full blur-[130px] transition-colors duration-1000"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, var(--aurora-3), transparent 72%)',
          opacity: mode === 'dark' ? 0.24 : 0.16,
        }}
      />

      {/* 极细建筑感星点网格 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--grid-line-color) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line-color) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse 85% 75% at 50% 25%, #000 35%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 75% at 50% 25%, #000 35%, transparent 100%)',
        }}
      />

      {/* 顶部微弱玻璃漫反射光带 */}
      <div
        className="absolute inset-x-0 top-0 h-[1px]"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--aurora-1), var(--aurora-2), var(--aurora-3), transparent)',
          opacity: mode === 'dark' ? 0.55 : 0.35,
        }}
      />
    </div>
  )
}
