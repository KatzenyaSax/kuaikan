import { create } from 'zustand'
import { DEFAULT_CHROMA, getCommunityChroma } from '@/shared/theme/community-chroma'
import type { AuroraChroma } from '@/shared/theme/community-chroma'
import { ensureFontStylesheet, getFontPresetById } from '@/shared/theme/font-presets'
import type { FontPreset, FontPresetId } from '@/shared/theme/font-presets'
import { getPresetById } from '@/shared/theme/theme-presets'
import type { ThemePreset, ThemePresetId } from '@/shared/theme/theme-presets'

export type ThemeMode = 'dark' | 'light'

type ThemeState = {
  mode: ThemeMode
  presetId: ThemePresetId
  preset: ThemePreset
  fontId: FontPresetId
  font: FontPreset
  /** 进入具体社群时，是否自动切换为该社群专属极光色系 */
  followCommunity: boolean
  /** 当前所处社群名（非社群页时为 null） */
  activeCommunity: string | null
  chroma: AuroraChroma
  setMode: (mode: ThemeMode) => void
  toggleMode: () => void
  setPreset: (presetId: ThemePresetId) => void
  setFont: (fontId: FontPresetId) => void
  setFollowCommunity: (follow: boolean) => void
  setActiveCommunity: (communityName: string | null) => void
}

function readSavedMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  try {
    const saved = window.localStorage.getItem('kuaikan-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // ignore
  }
  return 'dark'
}

function readSavedPreset(): ThemePresetId {
  if (typeof window === 'undefined') return 'aurora'
  try {
    const saved = window.localStorage.getItem('kuaikan-preset')
    if (saved) return getPresetById(saved).id
  } catch {
    // ignore
  }
  return 'aurora'
}

function readSavedFont(): FontPresetId {
  if (typeof window === 'undefined') return 'sans'
  try {
    const saved = window.localStorage.getItem('kuaikan-font')
    if (saved) return getFontPresetById(saved).id
  } catch {
    // ignore
  }
  return 'sans'
}

function applyFontToDom(font: FontPreset) {
  if (typeof document === 'undefined') return
  ensureFontStylesheet(font)
  const root = document.documentElement
  root.setAttribute('data-font', font.id)
  root.style.setProperty('--app-font-display', font.displayFamily)
  root.style.setProperty('--app-font-sans', font.bodyFamily)
  root.style.setProperty('--display-tracking', font.displayTracking)
}

function readSavedFollow(preset: ThemePreset): boolean {
  if (typeof window === 'undefined') return preset.defaultFollowCommunity
  try {
    const saved = window.localStorage.getItem('kuaikan-follow-community')
    if (saved === 'true') return true
    if (saved === 'false') return false
  } catch {
    // ignore
  }
  return preset.defaultFollowCommunity
}

function applyThemeToDom(
  mode: ThemeMode,
  preset: ThemePreset,
  followCommunity: boolean,
  activeCommunity: string | null,
  chroma: AuroraChroma,
) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', mode)
  root.setAttribute('data-preset', preset.id)
  root.classList.toggle('dark', mode === 'dark')

  const isDark = mode === 'dark'
  const t = isDark ? preset.dark : preset.light

  // 画布与材质基底始终由当前配色风格决定
  root.style.setProperty('--bg-canvas', t.canvas)
  root.style.setProperty('--bg-surface', t.surface)
  root.style.setProperty('--bg-surface-strong', t.surfaceStrong)
  root.style.setProperty('--bg-surface-hover', t.surfaceHover)
  root.style.setProperty('--bg-input', t.input)
  root.style.setProperty('--aurora-orb-opacity', t.orbOpacity)
  root.style.setProperty('--grid-line-color', t.gridLine)

  // 若开启「社群动态换肤」且正处于某个社群页，则将三色极光与主色同步为该社群色系
  if (followCommunity && activeCommunity) {
    root.style.setProperty('--aurora-1', isDark ? chroma.darkPrimary : chroma.lightPrimary)
    root.style.setProperty('--aurora-2', isDark ? chroma.darkSecondary : chroma.lightSecondary)
    root.style.setProperty('--aurora-3', isDark ? chroma.darkTertiary : chroma.lightTertiary)
    root.style.setProperty('--accent-rgb', isDark ? chroma.rgbDark : chroma.rgbLight)
    root.style.setProperty('--accent-gradient', chroma.gradient)
    root.style.setProperty('--btn-fg', '#FFFFFF')
  } else {
    root.style.setProperty('--aurora-1', t.aurora1)
    root.style.setProperty('--aurora-2', t.aurora2)
    root.style.setProperty('--aurora-3', t.aurora3)
    root.style.setProperty('--accent-rgb', t.accentRgb)
    root.style.setProperty('--accent-gradient', t.accentGradient)
    root.style.setProperty('--btn-fg', t.btnFg)
  }
}

const initialMode = readSavedMode()
const initialPresetId = readSavedPreset()
const initialPreset = getPresetById(initialPresetId)
const initialFontId = readSavedFont()
const initialFont = getFontPresetById(initialFontId)
const initialFollow = readSavedFollow(initialPreset)

applyThemeToDom(initialMode, initialPreset, initialFollow, null, DEFAULT_CHROMA)
applyFontToDom(initialFont)

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  presetId: initialPreset.id,
  preset: initialPreset,
  fontId: initialFont.id,
  font: initialFont,
  followCommunity: initialFollow,
  activeCommunity: null,
  chroma: DEFAULT_CHROMA,

  setMode: (mode) => {
    try {
      window.localStorage.setItem('kuaikan-theme', mode)
    } catch {
      // ignore
    }
    const s = get()
    applyThemeToDom(mode, s.preset, s.followCommunity, s.activeCommunity, s.chroma)
    set({ mode })
  },

  toggleMode: () => {
    const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark'
    get().setMode(next)
  },

  setPreset: (presetId) => {
    const nextPreset = getPresetById(presetId)
    const nextFollow = nextPreset.defaultFollowCommunity
    const s = get()
    const nextMode = nextPreset.preferredMode ?? s.mode
    try {
      window.localStorage.setItem('kuaikan-preset', nextPreset.id)
      window.localStorage.setItem('kuaikan-follow-community', String(nextFollow))
      window.localStorage.setItem('kuaikan-theme', nextMode)
    } catch {
      // ignore
    }
    applyThemeToDom(nextMode, nextPreset, nextFollow, s.activeCommunity, s.chroma)
    set({
      mode: nextMode,
      presetId: nextPreset.id,
      preset: nextPreset,
      followCommunity: nextFollow,
    })
  },

  setFont: (fontId) => {
    const nextFont = getFontPresetById(fontId)
    try {
      window.localStorage.setItem('kuaikan-font', nextFont.id)
    } catch {
      // ignore
    }
    applyFontToDom(nextFont)
    set({ fontId: nextFont.id, font: nextFont })
  },

  setFollowCommunity: (follow) => {
    try {
      window.localStorage.setItem('kuaikan-follow-community', String(follow))
    } catch {
      // ignore
    }
    const s = get()
    applyThemeToDom(s.mode, s.preset, follow, s.activeCommunity, s.chroma)
    set({ followCommunity: follow })
  },

  setActiveCommunity: (communityName) => {
    const s = get()
    const nextChroma = communityName ? getCommunityChroma(communityName) : DEFAULT_CHROMA
    if (s.activeCommunity === communityName && s.chroma.id === nextChroma.id) return
    applyThemeToDom(s.mode, s.preset, s.followCommunity, communityName, nextChroma)
    set({ activeCommunity: communityName, chroma: nextChroma })
  },
}))
