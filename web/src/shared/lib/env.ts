type ProcessLike = { env?: Record<string, string | undefined> }
type ViteEnv = { DEV?: boolean; PROD?: boolean; VITE_API_BASE_URL?: string }

const viteEnv = (import.meta as ImportMeta & { env?: ViteEnv }).env
const nodeEnv = (globalThis as { process?: ProcessLike }).process?.env

export const isBrowser = typeof window !== 'undefined'
export const isDev = viteEnv?.DEV === true

/**
 * API 基址解析顺序：
 *   1. Node 侧显式注入的 API_BASE_URL（冒烟脚本用）
 *   2. Vite 环境变量 VITE_API_BASE_URL
 *   3. 浏览器：空字符串（同源，由 nginx 或 Vite proxy 转发）
 *   4. Node 侧兜底：线上域名
 *
 * 不以 / 结尾 —— 与 request() 里的路径拼接约定一致，末尾带斜杠会拼出双斜杠。
 */
const explicit = nodeEnv?.API_BASE_URL ?? viteEnv?.VITE_API_BASE_URL
export const apiBaseUrl: string = explicit ?? (isBrowser ? '' : 'https://www.katzenyasax.top')

if (apiBaseUrl.endsWith('/')) {
  throw new Error(`API 基址不应以 / 结尾：${apiBaseUrl}`)
}
