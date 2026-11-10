import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地开发通过 Vite proxy 打服务器上的真后端。
// P1 的 refresh token 放在 httpOnly cookie 里，所以必须 changeOrigin + 转发 cookie。
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://www.katzenyasax.top'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: '',
      },
      // P4 的 SSE 会用到；Vite proxy 默认会缓冲，届时在这里加
      // configure: (proxy) => { ... 关闭缓冲 ... }
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
