import { useEffect } from 'react'
import { Check, Moon, Palette, Sparkles, Sun, Type } from 'lucide-react'
import { ensureFontStylesheet, FONT_PRESETS } from '@/shared/theme/font-presets'
import { THEME_PRESETS } from '@/shared/theme/theme-presets'
import { useTheme } from '@/shared/theme/theme-store'
import { Segmented } from '@/shared/ui/segmented'
import { Sheet } from '@/shared/ui/sheet'
import { cn } from '@/shared/lib/cn'

/**
 * 视觉风格工作室抽屉：
 * - 深浅模式切换（暗色 / 亮色）
 * - 4 套中文字体气质（原生极简 / 杂志宋体 / 霞鹜文楷 / 先锋得意黑）
 * - 7 套配色方案（多色极光 / 纯色极简 / 纯色专注 / 拼色 / 樱花粉白）
 * - 社群动态换肤独立开关
 */
export function ThemeStudioSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const mode = useTheme((s) => s.mode)
  const setMode = useTheme((s) => s.setMode)
  const presetId = useTheme((s) => s.presetId)
  const setPreset = useTheme((s) => s.setPreset)
  const fontId = useTheme((s) => s.fontId)
  const setFont = useTheme((s) => s.setFont)
  const followCommunity = useTheme((s) => s.followCommunity)
  const setFollowCommunity = useTheme((s) => s.setFollowCommunity)

  // 打开抽屉时预加载切片样式表，让 4 张字体样本卡直接呈现真实字形（不打开则 0 KB）
  useEffect(() => {
    if (!open) return
    for (const f of FONT_PRESETS) ensureFontStylesheet(f)
  }, [open])

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      testId="theme-studio-sheet"
      title={
        <span className="inline-flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <span>外观风格工作室</span>
        </span>
      }
      subtitle="配色、明暗与字体自由混搭，即时生效"
    >
      <div className="space-y-6">
        {/* 1. 深浅明暗极性 */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
              明暗模式
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {mode === 'dark' ? (
                <>
                  <Moon className="h-3.5 w-3.5 text-primary" /> 深色护眼
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5 text-warning" /> 亮色通透
                </>
              )}
            </span>
          </div>

          <Segmented
            value={mode}
            onChange={setMode}
            className="grid w-full grid-cols-2"
            options={[
              { value: 'dark', label: '深色模式', testId: 'theme-mode-dark' },
              { value: 'light', label: '亮色模式', testId: 'theme-mode-light' },
            ]}
          />
        </div>

        {/* 2. 四套中文字体气质 */}
        <div className="space-y-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted-foreground uppercase">
            <Type className="h-3.5 w-3.5 text-primary" />
            字体气质（{String(FONT_PRESETS.length)} 套）
          </span>

          <div className="grid grid-cols-2 gap-2.5">
            {FONT_PRESETS.map((f) => {
              const active = f.id === fontId
              return (
                <button
                  key={f.id}
                  type="button"
                  data-testid={`font-preset-${f.id}`}
                  onClick={() => setFont(f.id)}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-3 text-left transition-all duration-200',
                    active
                      ? 'border-[rgba(var(--accent-rgb),0.65)] bg-[var(--color-primary-soft)] shadow-sm'
                      : 'border-[var(--border-glass)] bg-[var(--bg-surface)] hover:border-[var(--border-glass-strong)] hover:bg-[var(--bg-surface-hover)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground">{f.name}</span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary stroke-[3]" />
                    ) : (
                      <span className="rounded-full bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {f.tag}
                      </span>
                    )}
                  </div>
                  <p
                    className="truncate text-sm font-semibold text-secondary-foreground"
                    style={{ fontFamily: f.displayFamily }}
                  >
                    {f.sample}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* 3. 整站配色方案 */}
        <div className="space-y-2.5">
          <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            整站配色方案（{String(THEME_PRESETS.length)} 套）
          </span>

          <div className="grid gap-3">
            {THEME_PRESETS.map((p) => {
              const active = p.id === presetId
              const previewTokens = mode === 'dark' ? p.dark : p.light

              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`theme-preset-${p.id}`}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    'group relative flex w-full cursor-pointer flex-col gap-3 rounded-2xl border p-3.5 text-left transition-all duration-200',
                    active
                      ? 'border-[rgba(var(--accent-rgb),0.65)] bg-[var(--color-primary-soft)] shadow-md'
                      : 'border-[var(--border-glass)] bg-[var(--bg-surface)] hover:border-[var(--border-glass-strong)] hover:bg-[var(--bg-surface-hover)]',
                  )}
                >
                  {/* 顶部标题 + 分类标签 + 选中徽章 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-bold text-foreground">
                        {p.name}
                      </span>
                      <span className="rounded-full border border-[var(--border-glass-strong)] bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                        {p.tag}
                      </span>
                    </div>

                    {active ? (
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full shadow-sm"
                        style={{
                          background: previewTokens.accentGradient,
                          color: previewTokens.btnFg,
                        }}
                      >
                        <Check className="h-3 w-3 stroke-[3]" />
                      </span>
                    ) : (
                      <div className="flex items-center -space-x-1">
                        {p.swatches.map((hex, i) => (
                          <span
                            key={i}
                            className="h-4 w-4 rounded-full ring-2 ring-[var(--bg-canvas)]"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 迷你界面配色预览条 */}
                  <div
                    className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 dark:border-white/10"
                    style={{ backgroundColor: previewTokens.canvas }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-8 rounded-full"
                        style={{ background: previewTokens.accentGradient }}
                      />
                      <span
                        className="h-2 w-12 rounded-full opacity-35"
                        style={{
                          backgroundColor: mode === 'dark' ? '#E2E8F0' : '#334155',
                        }}
                      />
                    </div>
                    <span
                      className="rounded-md px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        background: previewTokens.accentGradient,
                        color: previewTokens.btnFg,
                      }}
                    >
                      按钮
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {p.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* 3. 社群动态换肤独立开关 */}
        <div className="rounded-2xl border border-[var(--border-glass)] bg-[var(--bg-input)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                进入社群自动换肤
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                开启后每个社群呈现专属极光氛围；关闭则全站严格锁定为你选择的上方配色方案。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={followCommunity}
              data-testid="toggle-follow-community"
              onClick={() => setFollowCommunity(!followCommunity)}
              className={cn(
                'relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
                followCommunity
                  ? 'border-transparent'
                  : 'border-[var(--border-glass-strong)] bg-[var(--bg-surface)]',
              )}
              style={followCommunity ? { background: 'var(--accent-gradient)' } : undefined}
            >
              <span
                className={cn(
                  'inline-block h-4.5 w-4.5 rounded-full bg-white shadow transition-transform',
                  followCommunity ? 'translate-x-5.5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
