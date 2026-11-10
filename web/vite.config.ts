import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 本地开发通过 Vite proxy 打服务器上的真后端。
// P1 的 refresh token 放在 httpOnly cookie 里，所以必须 changeOrigin + 转发 cookie。
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://www.katzenyasax.top'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // mock 开关必须是**可静态折叠**的常量，否则 Rollup 无法把 mock 模块整块摇掉。
  // 写成 `import.meta.env.VITE_API_MOCK` 再经由变量间接访问是折不了的——
  // Vite 只替换字面表达式，不追踪变量。
  define: {
    __KUIKAN_API_MOCK__: JSON.stringify(process.env.VITE_API_MOCK === '1'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 端口被占时直接失败，而不是静默换到下一个可用端口。
    // 静默漂移会让"我明明起了 dev server 但请求打到了旧进程"这种问题极难排查。
    strictPort: true,
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
