import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root 不存在，index.html 被改坏了')
}

createRoot(rootEl).render(
  <StrictMode>
    <main style={{ padding: 32 }}>
      <h1>kuaikan</h1>
      <p style={{ color: 'var(--muted-foreground)' }}>P0.5 · S1 骨架就绪</p>
    </main>
  </StrictMode>,
)
