import { create } from 'zustand'
import { api, configureAuth } from '@/shared/api/client'
import { ApiError } from '@/shared/api/api-error'
import type { OkData, RequestBody } from '@/shared/api/typed'

/**
 * 后端 DTO 的字段在 OpenAPI 里都是可选的（springdoc 不会自动标 required），
 * 所以生成类型全是 `xxx?:`。会话层是这个契约的**信任边界**：
 * 在这里收口一次，把 wire 类型转成应用内类型，之后所有组件都不用再写 `??`。
 *
 * 收口失败要显式抛错而不是默默用空字符串——那会让"后端少返回一个字段"
 * 变成界面上莫名其妙的一行空白。
 */
export type UserProfile = {
  userId: string
  email: string
  nickname: string
  avatarUrl: string | null
  roles: string
  createdAt: string
}

type WireProfile = OkData<'me'>

export type SessionItem = OkData<'sessions'>[number]

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('BAD_RESPONSE', `登录响应缺少字段 ${field}`, 0)
  }
  return value
}

function narrowProfile(wire: WireProfile | undefined): UserProfile {
  if (!wire) {
    throw new ApiError('BAD_RESPONSE', '登录响应缺少 user', 0)
  }
  return {
    userId: requireString(wire.userId, 'user.userId'),
    email: requireString(wire.email, 'user.email'),
    nickname: requireString(wire.nickname, 'user.nickname'),
    avatarUrl: wire.avatarUrl ?? null,
    roles: wire.roles ?? 'USER',
    createdAt: wire.createdAt ?? '',
  }
}

type WireLogin = OkData<'login'>

function narrowLogin(wire: WireLogin): { accessToken: string; user: UserProfile } {
  return {
    accessToken: requireString(wire.accessToken, 'accessToken'),
    user: narrowProfile(wire.user),
  }
}

/**
 * unknown 是**第三态**，不是 false。
 *
 * 因为 refresh token 在 httpOnly cookie 里，JS 读不到它 —— 前端无法同步判断
 * "是否已登录"。启动时必须先打一次 /auth/refresh 才知道。
 * 守卫若把 unknown 当成未登录，每次刷新都会先闪一下登录页再跳回来。
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous'

/**
 * 会话是怎么结束的。
 *
 * 区分这个的唯一目的是**给用户一句准确的话**：
 * "登录已过期，请重新登录" 和 "账号已被封禁" 是完全不同的两件事，
 * 前者他会重试，后者他该去找管理员。
 */
export type LogoutReason = 'manual' | 'expired' | 'banned' | null

type SessionState = {
  status: AuthStatus
  accessToken: string | null
  user: UserProfile | null
  logoutReason: LogoutReason

  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  clear: () => void
}

const AUTH_BASE = '/api/user/auth'

/** 用 refresh cookie 换一对新 token；失败返回 null（不抛，调用方据此判定匿名态） */
async function refreshTokens(): Promise<string | null> {
  try {
    const wire = await api.post<WireLogin>(`${AUTH_BASE}/refresh`, undefined, {
      skipAuthRetry: true,
    })
    const payload = narrowLogin(wire)
    useSession.setState({
      status: 'authenticated',
      accessToken: payload.accessToken,
      user: payload.user,
    })
    return payload.accessToken
  } catch (err) {
    // 只有在"之前是已登录"时才算一次被动的会话结束。
    // 首次访问（status=unknown）时的 401 是正常的"没登录"，不该给用户弹提示。
    const wasAuthenticated = useSession.getState().status === 'authenticated'
    const banned = err instanceof ApiError && err.code === 40205
    useSession.setState({
      status: 'anonymous',
      accessToken: null,
      user: null,
      ...(wasAuthenticated ? { logoutReason: banned ? 'banned' : 'expired' } : {}),
    })
    return null
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'unknown',
  accessToken: null,
  user: null,
  logoutReason: null,

  /** 页面启动时调用一次：静默续期，成功即已登录 */
  bootstrap: async () => {
    if (get().status !== 'unknown') return
    await refreshTokens()
  },

  login: async (email, password) => {
    const body: RequestBody<'login'> = { email, password }
    const wire = await api.post<WireLogin>(`${AUTH_BASE}/login`, body)
    const payload = narrowLogin(wire)
    set({ status: 'authenticated', accessToken: payload.accessToken, user: payload.user, logoutReason: null })
  },

  logout: async () => {
    try {
      await api.post<void>(`${AUTH_BASE}/logout`)
    } catch {
      // 登出必须幂等：服务端已经失效时也应该把本地状态清干净
    }
    set({ status: 'anonymous', accessToken: null, user: null, logoutReason: 'manual' })
  },

  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}))

/**
 * 把会话接到 client 上。
 *
 * 方向是「会话 → client」而不是反过来，否则会形成
 * client → session → client 的循环依赖。
 */
configureAuth({
  getToken: () => useSession.getState().accessToken,
  refresh: refreshTokens,
  onUnauthorized: () => {
    useSession.setState({ status: 'anonymous', accessToken: null, user: null })
  },
})
