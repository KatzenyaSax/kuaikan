/**
 * 社群动态极光色系引擎（Community Chroma Engine）。
 *
 * 每个社群根据其规范名称确定性映射到一组经过人工校准的和谐极光三色组：
 * 绝不使用随机 HSL（容易撞出刺眼或发脏的荧光色），而是精选 10 套深浅双主题均耐看的高级配色。
 */

export type AuroraChroma = {
  id: string
  name: string
  /** 深色模式主光 / 副光 / 环境第三光 */
  darkPrimary: string
  darkSecondary: string
  darkTertiary: string
  /** 亮色模式高对比主色 / 副色 / 柔光 */
  lightPrimary: string
  lightSecondary: string
  lightTertiary: string
  /** RGB 三元组（用于 CSS rgba(var(--accent-rgb), 0.xx)） */
  rgbDark: string
  rgbLight: string
  /** 渐变徽章 / 头像底色 */
  gradient: string
}

export const DEFAULT_CHROMA: AuroraChroma = {
  id: 'prism-default',
  name: '星河极光',
  darkPrimary: '#8B5CF6',
  darkSecondary: '#22D3EE',
  darkTertiary: '#FB7185',
  lightPrimary: '#6D28D9',
  lightSecondary: '#0284C7',
  lightTertiary: '#E11D48',
  rgbDark: '139, 92, 246',
  rgbLight: '109, 40, 217',
  gradient: 'linear-gradient(135deg, #8B5CF6 0%, #22D3EE 55%, #FB7185 100%)',
}

export const COMMUNITY_PALETTES: readonly AuroraChroma[] = [
  {
    id: 'violet-cyan',
    name: '紫电青冥',
    darkPrimary: '#8B5CF6',
    darkSecondary: '#22D3EE',
    darkTertiary: '#EC4899',
    lightPrimary: '#6D28D9',
    lightSecondary: '#0891B2',
    lightTertiary: '#DB2777',
    rgbDark: '139, 92, 246',
    rgbLight: '109, 40, 217',
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #22D3EE 100%)',
  },
  {
    id: 'coral-amber',
    name: '珊瑚落日',
    darkPrimary: '#FB7185',
    darkSecondary: '#F59E0B',
    darkTertiary: '#A855F7',
    lightPrimary: '#E11D48',
    lightSecondary: '#D97706',
    lightTertiary: '#7E22CE',
    rgbDark: '251, 113, 133',
    rgbLight: '225, 29, 72',
    gradient: 'linear-gradient(135deg, #FB7185 0%, #F59E0B 100%)',
  },
  {
    id: 'emerald-aqua',
    name: '翡翠极光',
    darkPrimary: '#10B981',
    darkSecondary: '#06B6D4',
    darkTertiary: '#6366F1',
    lightPrimary: '#059669',
    lightSecondary: '#0891B2',
    lightTertiary: '#4F46E5',
    rgbDark: '16, 185, 129',
    rgbLight: '5, 150, 105',
    gradient: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)',
  },
  {
    id: 'cobalt-sky',
    name: '湛蓝星轨',
    darkPrimary: '#3B82F6',
    darkSecondary: '#38BDF8',
    darkTertiary: '#A78BFA',
    lightPrimary: '#2563EB',
    lightSecondary: '#0284C7',
    lightTertiary: '#7C3AED',
    rgbDark: '59, 130, 246',
    rgbLight: '37, 99, 235',
    gradient: 'linear-gradient(135deg, #3B82F6 0%, #38BDF8 100%)',
  },
  {
    id: 'fuchsia-indigo',
    name: '绯红星云',
    darkPrimary: '#E879F9',
    darkSecondary: '#F43F5E',
    darkTertiary: '#6366F1',
    lightPrimary: '#C026D3',
    lightSecondary: '#E11D48',
    lightTertiary: '#4F46E5',
    rgbDark: '232, 121, 249',
    rgbLight: '192, 38, 211',
    gradient: 'linear-gradient(135deg, #D946EF 0%, #F43F5E 100%)',
  },
  {
    id: 'amber-rose',
    name: '琥珀流金',
    darkPrimary: '#EA580C',
    darkSecondary: '#E11D48',
    darkTertiary: '#F59E0B',
    lightPrimary: '#C2410C',
    lightSecondary: '#BE123C',
    lightTertiary: '#D97706',
    rgbDark: '234, 88, 12',
    rgbLight: '194, 65, 12',
    gradient: 'linear-gradient(135deg, #EA580C 0%, #E11D48 100%)',
  },
  {
    id: 'teal-lime',
    name: '青柠幻境',
    darkPrimary: '#0D9488',
    darkSecondary: '#16A34A',
    darkTertiary: '#06B6D4',
    lightPrimary: '#0F766E',
    lightSecondary: '#15803D',
    lightTertiary: '#0891B2',
    rgbDark: '13, 148, 136',
    rgbLight: '15, 118, 110',
    gradient: 'linear-gradient(135deg, #0D9488 0%, #16A34A 100%)',
  },
  {
    id: 'indigo-lavender',
    name: '靛青暮色',
    darkPrimary: '#6366F1',
    darkSecondary: '#A855F7',
    darkTertiary: '#22D3EE',
    lightPrimary: '#4F46E5',
    lightSecondary: '#9333EA',
    lightTertiary: '#0891B2',
    rgbDark: '99, 102, 241',
    rgbLight: '79, 70, 229',
    gradient: 'linear-gradient(135deg, #6366F1 0%, #A855F7 100%)',
  },
  {
    id: 'tangerine-pink',
    name: '蜜桃霓虹',
    darkPrimary: '#EA580C',
    darkSecondary: '#DB2777',
    darkTertiary: '#8B5CF6',
    lightPrimary: '#C2410C',
    lightSecondary: '#BE185D',
    lightTertiary: '#7C3AED',
    rgbDark: '234, 88, 12',
    rgbLight: '194, 65, 12',
    gradient: 'linear-gradient(135deg, #F97316 0%, #DB2777 100%)',
  },
  {
    id: 'glacier-mint',
    name: '冰川苍蓝',
    darkPrimary: '#0284C7',
    darkSecondary: '#059669',
    darkTertiary: '#6366F1',
    lightPrimary: '#0369A1',
    lightSecondary: '#047857',
    lightTertiary: '#4F46E5',
    rgbDark: '2, 132, 199',
    rgbLight: '3, 105, 161',
    gradient: 'linear-gradient(135deg, #0284C7 0%, #059669 100%)',
  },
]

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** 按名称确定性获取社群极光色系 */
export function getCommunityChroma(seed?: string | null): AuroraChroma {
  if (!seed || !seed.trim()) return DEFAULT_CHROMA
  const idx = hashString(seed.trim().toLowerCase()) % COMMUNITY_PALETTES.length
  return COMMUNITY_PALETTES[idx] ?? DEFAULT_CHROMA
}

/** 按用户昵称或 ID 获取柔和的个人色系 */
export function getUserChroma(seed?: string | null): AuroraChroma {
  return getCommunityChroma(seed)
}

/** 五类消息语义色配置 */
export const MESSAGE_SEMANTICS = {
  LIKE: {
    label: '赞',
    color: '#FB7185',
    lightColor: '#E11D48',
    bg: 'rgba(251, 113, 133, 0.14)',
    border: 'rgba(251, 113, 133, 0.35)',
    gradient: 'linear-gradient(135deg, #FB7185, #F43F5E)',
  },
  COMMENT: {
    label: '评论',
    color: '#22D3EE',
    lightColor: '#0284C7',
    bg: 'rgba(34, 211, 238, 0.14)',
    border: 'rgba(34, 211, 238, 0.35)',
    gradient: 'linear-gradient(135deg, #22D3EE, #3B82F6)',
  },
  MENTION: {
    label: '@',
    color: '#A78BFA',
    lightColor: '#7C3AED',
    bg: 'rgba(167, 139, 250, 0.14)',
    border: 'rgba(167, 139, 250, 0.35)',
    gradient: 'linear-gradient(135deg, #A78BFA, #EC4899)',
  },
  FOLLOW: {
    label: '关注',
    color: '#34D399',
    lightColor: '#059669',
    bg: 'rgba(52, 211, 153, 0.14)',
    border: 'rgba(52, 211, 153, 0.35)',
    gradient: 'linear-gradient(135deg, #34D399, #06B6D4)',
  },
  SYSTEM: {
    label: '系统',
    color: '#FBBF24',
    lightColor: '#D97706',
    bg: 'rgba(251, 191, 36, 0.14)',
    border: 'rgba(251, 191, 36, 0.35)',
    gradient: 'linear-gradient(135deg, #FBBF24, #F97316)',
  },
} as const
