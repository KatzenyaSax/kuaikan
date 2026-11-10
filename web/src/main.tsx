import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import '@/styles/index.css'
import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root 不存在，index.html 被改坏了')
}

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
