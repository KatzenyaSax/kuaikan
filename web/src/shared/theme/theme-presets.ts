/**
 * 六套精心校准的整站配色风格（均提供深色 + 亮色完整双主题映射）：
 * - 多色流光：星河极光
 * - 纯色极简：水墨极简、靛蓝纯境
 * - 高级拼色：琥珀石墨、抹茶松石、绯红紫罗兰
 */

export type ThemePresetId =
  | 'aurora'
  | 'mono'
  | 'cobalt'
  | 'amber-slate'
  | 'matcha-cream'
  | 'crimson-violet'
  | 'sakura'

export type PresetTokens = {
  canvas: string
  surface: string
  surfaceStrong: string
  surfaceHover: string
  input: string
  aurora1: string
  aurora2: string
  aurora3: string
  accentRgb: string
  accentGradient: string
  /** 主按钮与高亮胶囊上的文字色（水墨暗色为深黑字，其余为纯白字） */
  btnFg: string
  /** 背景极光光球透明度（纯色极简极低，多色极光饱满） */
  orbOpacity: string
  /** 极光背景光球是否启用渐变动画 */
  gridLine: string
}

export type ThemePreset = {
  id: ThemePresetId
  name: string
  tag: '多色流光' | '纯色极简' | '纯色专注' | '复古拼色' | '自然拼色' | '先锋撞色' | '浪漫粉白'
  description: string
  /** 切到该风格时默认是否开启「进入社群自动换肤」 */
  defaultFollowCommunity: boolean
  /** 若指定，选中该方案时自动切至其代表明暗模式（后续仍可自由手动切换） */
  preferredMode?: 'dark' | 'light'
  /** 预览卡片上的 3 个代表色块 */
  swatches: readonly [string, string, string]
  dark: PresetTokens
  light: PresetTokens
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'aurora',
    name: '星河极光',
    tag: '多色流光',
    description: '紫电、星青与珊瑚粉交织的呼吸感琉璃极光',
    defaultFollowCommunity: true,
    swatches: ['#8B5CF6', '#22D3EE', '#FB7185'],
    dark: {
      canvas: '#070913',
      surface: 'rgba(15, 20, 38, 0.62)',
      surfaceStrong: 'rgba(19, 25, 48, 0.80)',
      surfaceHover: 'rgba(34, 44, 78, 0.72)',
      input: 'rgba(10, 14, 28, 0.65)',
      aurora1: '#8B5CF6',
      aurora2: '#22D3EE',
      aurora3: '#FB7185',
      accentRgb: '139, 92, 246',
      accentGradient: 'linear-gradient(135deg, #8B5CF6 0%, #0EA5E9 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.34',
      gridLine: 'rgba(255, 255, 255, 0.025)',
    },
    light: {
      canvas: '#F3F6FF',
      surface: 'rgba(255, 255, 255, 0.74)',
      surfaceStrong: 'rgba(255, 255, 255, 0.90)',
      surfaceHover: 'rgba(246, 248, 255, 0.94)',
      input: 'rgba(255, 255, 255, 0.88)',
      aurora1: '#6D28D9',
      aurora2: '#0284C7',
      aurora3: '#E11D48',
      accentRgb: '109, 40, 217',
      accentGradient: 'linear-gradient(135deg, #6D28D9 0%, #0284C7 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.22',
      gridLine: 'rgba(99, 102, 241, 0.045)',
    },
  },
  {
    id: 'mono',
    name: '水墨极简',
    tag: '纯色极简',
    description: '零多余色彩的黑曜与瓷白，杂志级克制建筑感',
    defaultFollowCommunity: false,
    swatches: ['#18181B', '#71717A', '#F4F4F5'],
    dark: {
      canvas: '#09090B',
      surface: 'rgba(20, 20, 23, 0.78)',
      surfaceStrong: 'rgba(26, 26, 30, 0.92)',
      surfaceHover: 'rgba(39, 39, 44, 0.85)',
      input: 'rgba(15, 15, 18, 0.82)',
      aurora1: '#E4E4E7',
      aurora2: '#A1A1AA',
      aurora3: '#71717A',
      accentRgb: '212, 212, 216',
      accentGradient: 'linear-gradient(135deg, #F4F4F5 0%, #D4D4D8 100%)',
      btnFg: '#09090B',
      orbOpacity: '0.07',
      gridLine: 'rgba(255, 255, 255, 0.028)',
    },
    light: {
      canvas: '#F7F7F8',
      surface: 'rgba(255, 255, 255, 0.86)',
      surfaceStrong: 'rgba(255, 255, 255, 0.96)',
      surfaceHover: 'rgba(244, 244, 245, 0.96)',
      input: 'rgba(255, 255, 255, 0.94)',
      aurora1: '#18181B',
      aurora2: '#3F3F46',
      aurora3: '#71717A',
      accentRgb: '24, 24, 27',
      accentGradient: 'linear-gradient(135deg, #18181B 0%, #27272A 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.05',
      gridLine: 'rgba(24, 24, 27, 0.038)',
    },
  },
  {
    id: 'cobalt',
    name: '靛蓝纯境',
    tag: '纯色专注',
    description: '单一皇家钴蓝色阶，清澈理性、长文阅读无干扰',
    defaultFollowCommunity: false,
    swatches: ['#1D4ED8', '#3B82F6', '#93C5FD'],
    dark: {
      canvas: '#070B14',
      surface: 'rgba(13, 21, 38, 0.74)',
      surfaceStrong: 'rgba(17, 27, 49, 0.88)',
      surfaceHover: 'rgba(28, 44, 78, 0.78)',
      input: 'rgba(10, 16, 30, 0.78)',
      aurora1: '#3B82F6',
      aurora2: '#2563EB',
      aurora3: '#60A5FA',
      accentRgb: '59, 130, 246',
      accentGradient: 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.20',
      gridLine: 'rgba(147, 197, 253, 0.03)',
    },
    light: {
      canvas: '#F4F8FF',
      surface: 'rgba(255, 255, 255, 0.82)',
      surfaceStrong: 'rgba(255, 255, 255, 0.94)',
      surfaceHover: 'rgba(239, 246, 255, 0.94)',
      input: 'rgba(255, 255, 255, 0.92)',
      aurora1: '#1D4ED8',
      aurora2: '#2563EB',
      aurora3: '#3B82F6',
      accentRgb: '29, 78, 216',
      accentGradient: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.13',
      gridLine: 'rgba(37, 99, 235, 0.04)',
    },
  },
  {
    id: 'amber-slate',
    name: '琥珀石墨',
    tag: '复古拼色',
    description: '温暖焦糖琥珀 × 沉静石墨灰，胶片书房般的温润质感',
    defaultFollowCommunity: false,
    swatches: ['#D97706', '#EA580C', '#44403C'],
    dark: {
      canvas: '#0E0C0A',
      surface: 'rgba(26, 22, 19, 0.76)',
      surfaceStrong: 'rgba(34, 29, 25, 0.90)',
      surfaceHover: 'rgba(50, 42, 35, 0.82)',
      input: 'rgba(19, 16, 14, 0.80)',
      aurora1: '#F59E0B',
      aurora2: '#EA580C',
      aurora3: '#78716C',
      accentRgb: '245, 158, 11',
      accentGradient: 'linear-gradient(135deg, #D97706 0%, #EA580C 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.20',
      gridLine: 'rgba(245, 158, 11, 0.032)',
    },
    light: {
      canvas: '#FAF6F0',
      surface: 'rgba(255, 253, 249, 0.84)',
      surfaceStrong: 'rgba(255, 253, 250, 0.95)',
      surfaceHover: 'rgba(254, 243, 226, 0.88)',
      input: 'rgba(255, 255, 255, 0.92)',
      aurora1: '#C2410C',
      aurora2: '#D97706',
      aurora3: '#57534E',
      accentRgb: '194, 65, 12',
      accentGradient: 'linear-gradient(135deg, #C2410C 0%, #D97706 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.14',
      gridLine: 'rgba(180, 83, 9, 0.042)',
    },
  },
  {
    id: 'matcha-cream',
    name: '抹茶松石',
    tag: '自然拼色',
    description: '森林翡翠 × 苍绿松石双拼，护眼舒缓的植物画册气韵',
    defaultFollowCommunity: false,
    swatches: ['#059669', '#0D9488', '#34D399'],
    dark: {
      canvas: '#07110E',
      surface: 'rgba(13, 27, 23, 0.74)',
      surfaceStrong: 'rgba(17, 36, 30, 0.88)',
      surfaceHover: 'rgba(26, 52, 44, 0.80)',
      input: 'rgba(10, 20, 17, 0.78)',
      aurora1: '#10B981',
      aurora2: '#0D9488',
      aurora3: '#34D399',
      accentRgb: '16, 185, 129',
      accentGradient: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.22',
      gridLine: 'rgba(52, 211, 153, 0.03)',
    },
    light: {
      canvas: '#F2F9F6',
      surface: 'rgba(255, 255, 255, 0.82)',
      surfaceStrong: 'rgba(255, 255, 255, 0.94)',
      surfaceHover: 'rgba(236, 253, 245, 0.92)',
      input: 'rgba(255, 255, 255, 0.92)',
      aurora1: '#047857',
      aurora2: '#0F766E',
      aurora3: '#10B981',
      accentRgb: '4, 120, 87',
      accentGradient: 'linear-gradient(135deg, #047857 0%, #0F766E 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.15',
      gridLine: 'rgba(5, 150, 105, 0.042)',
    },
  },
  {
    id: 'crimson-violet',
    name: '绯红紫罗兰',
    tag: '先锋撞色',
    description: '洋红玫瑰 × 皇家紫高饱和双撞色，潮流刊物般惊艳抢眼',
    defaultFollowCommunity: false,
    swatches: ['#E11D48', '#9333EA', '#F472B6'],
    dark: {
      canvas: '#0C0712',
      surface: 'rgba(24, 14, 34, 0.72)',
      surfaceStrong: 'rgba(32, 18, 46, 0.88)',
      surfaceHover: 'rgba(48, 26, 68, 0.78)',
      input: 'rgba(18, 10, 26, 0.76)',
      aurora1: '#F43F5E',
      aurora2: '#9333EA',
      aurora3: '#EC4899',
      accentRgb: '244, 63, 94',
      accentGradient: 'linear-gradient(135deg, #E11D48 0%, #9333EA 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.30',
      gridLine: 'rgba(244, 114, 182, 0.03)',
    },
    light: {
      canvas: '#FDF5F9',
      surface: 'rgba(255, 255, 255, 0.80)',
      surfaceStrong: 'rgba(255, 255, 255, 0.94)',
      surfaceHover: 'rgba(253, 242, 248, 0.94)',
      input: 'rgba(255, 255, 255, 0.92)',
      aurora1: '#BE123C',
      aurora2: '#7E22CE',
      aurora3: '#DB2777',
      accentRgb: '190, 18, 60',
      accentGradient: 'linear-gradient(135deg, #BE123C 0%, #7E22CE 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.18',
      gridLine: 'rgba(190, 18, 60, 0.04)',
    },
  },
  {
    id: 'sakura',
    name: '樱花粉白',
    tag: '浪漫粉白',
    description: '初樱奶白画布配樱桃玫瑰粉，点选即绽放粉白柔光（亦可切暗色赏夜樱）',
    defaultFollowCommunity: false,
    preferredMode: 'light',
    swatches: ['#FFF7FA', '#F472B6', '#DB2777'],
    dark: {
      canvas: '#11090E',
      surface: 'rgba(29, 16, 24, 0.76)',
      surfaceStrong: 'rgba(39, 21, 32, 0.90)',
      surfaceHover: 'rgba(56, 30, 46, 0.82)',
      input: 'rgba(22, 12, 18, 0.80)',
      aurora1: '#F472B6',
      aurora2: '#FB7185',
      aurora3: '#F9A8D4',
      accentRgb: '244, 114, 182',
      accentGradient: 'linear-gradient(135deg, #DB2777 0%, #F472B6 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.24',
      gridLine: 'rgba(244, 114, 182, 0.035)',
    },
    light: {
      canvas: '#FFF7FA',
      surface: 'rgba(255, 255, 255, 0.84)',
      surfaceStrong: 'rgba(255, 255, 255, 0.96)',
      surfaceHover: 'rgba(255, 240, 246, 0.95)',
      input: 'rgba(255, 255, 255, 0.94)',
      aurora1: '#DB2777',
      aurora2: '#EC4899',
      aurora3: '#F9A8D4',
      accentRgb: '219, 39, 119',
      accentGradient: 'linear-gradient(135deg, #DB2777 0%, #F472B6 100%)',
      btnFg: '#FFFFFF',
      orbOpacity: '0.20',
      gridLine: 'rgba(219, 39, 119, 0.042)',
    },
  },
]

export function getPresetById(id: string | null | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]!
}
