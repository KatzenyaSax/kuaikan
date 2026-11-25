import { create } from 'zustand'

export type AiPendingIntent = {
  key: number
  intent: 'SUMMARIZE_POST' | 'UNREAD_SUMMARY'
  prompt: string
  pageContext?: {
    type: 'POST' | 'COMMUNITY' | 'HOME' | 'SEARCH' | 'USER' | 'OTHER'
    postId?: string
    communityName?: string
    userId?: string
  }
}

export type DraftCommentPrefill = {
  key: number
  postId: string
  text: string
}

type AiStoreState = {
  drawerOpen: boolean
  pendingIntent: AiPendingIntent | null
  draftCommentPrefill: DraftCommentPrefill | null
  openDrawer: (preset?: Omit<AiPendingIntent, 'key'>) => void
  closeDrawer: () => void
  toggleDrawer: () => void
  consumePendingIntent: () => void
  setDraftCommentPrefill: (postId: string, text: string) => void
  consumeDraftCommentPrefill: (postId: string) => string | null
}

/**
 * 全局轻量 AI 抽屉与跨组件联动 store。
 * 本身不发任何网络请求，保持主站首屏零 AI 请求。
 */
export const useAiStore = create<AiStoreState>((set, get) => ({
  drawerOpen: false,
  pendingIntent: null,
  draftCommentPrefill: null,

  openDrawer: (preset) =>
    set({
      drawerOpen: true,
      pendingIntent: preset ? { ...preset, key: Date.now() } : get().pendingIntent,
    }),

  closeDrawer: () => set({ drawerOpen: false }),

  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

  consumePendingIntent: () => set({ pendingIntent: null }),

  setDraftCommentPrefill: (postId, text) =>
    set({ draftCommentPrefill: { key: Date.now(), postId, text } }),

  consumeDraftCommentPrefill: (postId) => {
    const cur = get().draftCommentPrefill
    if (!cur || cur.postId !== postId) return null
    set({ draftCommentPrefill: null })
    return cur.text
  },
}))
