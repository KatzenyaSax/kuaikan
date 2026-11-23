/**
 * 四套中英文混排字体气质方案（采用按需懒加载 + unicode-range 分片切片，零拖慢首屏）：
 * - sans      原生极简（零外部中文字体请求）
 * - editorial 杂志衬线（思源宋体标题 × 现代黑体正文）
 * - wenkai    温润手账（霞鹜文楷全站阅读）
 * - smiley    先锋海报（得意黑标题 × 现代黑体正文）
 */

export type FontPresetId = 'sans' | 'editorial' | 'wenkai' | 'smiley'

export type FontPreset = {
  id: FontPresetId
  name: string
  tag: string
  sample: string
  /** 仅当选中该字体时动态注入 <link rel="stylesheet"> */
  stylesheetUrl?: string
  displayFamily: string
  bodyFamily: string
  displayTracking: string
}

const SYSTEM_SANS =
  '"Plus Jakarta Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'

export const FONT_PRESETS: readonly FontPreset[] = [
  {
    id: 'sans',
    name: '原生极简',
    tag: '零延迟',
    sample: '清晰利落 · 2026',
    displayFamily: `"Space Grotesk", ${SYSTEM_SANS}`,
    bodyFamily: SYSTEM_SANS,
    displayTracking: '-0.025em',
  },
  {
    id: 'editorial',
    name: '杂志宋体',
    tag: '书卷质感',
    sample: '流光画廊 · 2026',
    stylesheetUrl:
      'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700;900&display=swap',
    displayFamily: '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
    bodyFamily: SYSTEM_SANS,
    displayTracking: '0.01em',
  },
  {
    id: 'wenkai',
    name: '霞鹜文楷',
    tag: '温润手账',
    sample: '春风十里 · 2026',
    stylesheetUrl: 'https://fontsapi.zeoseven.com/292/main/result.css',
    displayFamily: '"LXGW WenKai", "Kaiti SC", "STKaiti", serif',
    bodyFamily: `"LXGW WenKai", ${SYSTEM_SANS}`,
    displayTracking: '0.01em',
  },
  {
    id: 'smiley',
    name: '先锋得意黑',
    tag: '海报张力',
    sample: '极光宇宙 · 2026',
    stylesheetUrl:
      'https://cdn.jsdelivr.net/npm/@chinese-fonts/dyh/dist/SmileySans-Oblique/result.css',
    displayFamily: `"Smiley Sans Oblique", "Space Grotesk", ${SYSTEM_SANS}`,
    bodyFamily: SYSTEM_SANS,
    displayTracking: '0.025em',
  },
]

export function getFontPresetById(id: string | null | undefined): FontPreset {
  return FONT_PRESETS.find((f) => f.id === id) ?? FONT_PRESETS[0]!
}

/** 幂等按需注入切片字体样式表 */
export function ensureFontStylesheet(preset: FontPreset) {
  if (typeof document === 'undefined' || !preset.stylesheetUrl) return
  const attr = `data-kuaikan-font="${preset.id}"`
  if (document.head.querySelector(`link[${attr}]`)) return

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = preset.stylesheetUrl
  link.setAttribute('data-kuaikan-font', preset.id)
  document.head.appendChild(link)
}
