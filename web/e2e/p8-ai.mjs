// P8 的浏览器层验收：Copilot 抽屉、快捷触发、互斥、懒加载隔离、内联帮写。
//
//   node web/e2e/p8-ai.mjs
//
// 由 deploy/bin/verify-p8.sh 的 L3 调用。不用 @playwright/test，只用 playwright。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const SITE_IP = process.env.E2E_SITE_IP
const USER_EMAIL = process.env.E2E_USER_EMAIL
const USER_PASSWORD = process.env.E2E_USER_PASSWORD
const COMMUNITY = process.env.E2E_COMMUNITY
const POST_ID = process.env.E2E_POST_ID

const required = {
  E2E_USER_EMAIL: USER_EMAIL,
  E2E_USER_PASSWORD: USER_PASSWORD,
  E2E_COMMUNITY: COMMUNITY,
  E2E_POST_ID: POST_ID,
}
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k)
if (missing.length > 0) {
  console.error(`缺少环境变量：${missing.join(' / ')}`)
  process.exit(2)
}

const COMMUNITY_PATH = `/c/${encodeURIComponent(COMMUNITY)}`
const POST_PATH = `${COMMUNITY_PATH}/p/${POST_ID}`
const NEW_POST_PATH = `${COMMUNITY_PATH}/new`

const results = []
const ok = (msg, extra) => {
  results.push({ ok: true, msg })
  console.log(`  ✓ ${msg}${extra ? `  ${extra}` : ''}`)
}
const ng = (msg, detail) => {
  results.push({ ok: false, msg })
  console.log(`  ✗ ${msg}${detail ? `  — ${detail}` : ''}`)
}

async function launchBrowser() {
  const host = new URL(SITE).hostname
  const args = SITE_IP
    ? [`--host-resolver-rules=MAP ${host} ${SITE_IP}`, '--no-proxy-server']
    : []
  const attempts = [
    { label: 'bundled chromium', options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } },
  ]
  const errors = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({ ...attempt.options, args })
      console.log(
        `  (浏览器：${attempt.label}${SITE_IP ? `，直连 ${host} → ${SITE_IP}` : ''})`,
      )
      return browser
    } catch (e) {
      errors.push(`${attempt.label}: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error(`无法启动浏览器：\n  ${errors.join('\n  ')}`)
}

function watchErrors(page, bucket) {
  page.on('pageerror', (e) => bucket.push(`pageerror: ${String(e.message).split('\n')[0]}`))
  page.on('response', (r) => {
    if (r.status() < 400) return
    const target = r.url()
    if (/\/api\/user\/auth\/refresh$/.test(target)) return
    if (/\/api\/notification\/stream$/.test(target)) return
    if (/\/api\/ai\//.test(target) && r.status() === 503) return
    bucket.push(`${String(r.status())} ${target}`)
  })
}

async function login(page, email, password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('field-email').fill(email)
  await page.getByTestId('field-password').fill(password)
  await page.getByTestId('btn-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 })
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 25000 })
}

const browser = await launchBrowser()
let guestCtx
let userCtx
try {
  // ================================================================ 1. 游客首屏零 AI 请求 + 引导登录
  guestCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const guest = await guestCtx.newPage()
  const guestErrors = []
  const guestAiRequests = []
  watchErrors(guest, guestErrors)
  guest.on('request', (req) => {
    if (/\/api\/ai\//.test(req.url())) guestAiRequests.push(req.url())
  })

  await guest.goto('/', { waitUntil: 'networkidle' })
  await guest.getByTestId('nav-ai').waitFor({ state: 'visible', timeout: 20000 })
  if (guestAiRequests.length === 0) {
    ok('游客首页零 /api/ai/** 请求（懒加载与隔离生效）')
  } else {
    ng('游客首页意外发起了 AI 请求', guestAiRequests.join(', '))
  }

  await guest.getByTestId('nav-ai').click()
  await guest.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 15000 })
  ok('游客点击顶栏 AI 按钮跳转登录页')
  if (guestErrors.length === 0) ok('游客路径零异常报错')
  else ng('游客路径出现报错', guestErrors.join('; '))

  // ================================================================ 2. 登录用户抽屉、互斥与触发点
  userCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const page = await userCtx.newPage()
  const userErrors = []
  const userAiHomeReqs = []
  page.on('request', (req) => {
    if (/\/api\/ai\//.test(req.url())) userAiHomeReqs.push(req.url())
  })
  watchErrors(page, userErrors)

  await login(page, USER_EMAIL, USER_PASSWORD)
  await page.waitForTimeout(800)
  if (userAiHomeReqs.length === 0) {
    ok('登录用户未打开抽屉时首屏零 /api/ai/** 请求')
  } else {
    ng('登录用户未打开抽屉却发起了 AI 请求', userAiHomeReqs.join(', '))
  }

  // 打开 Copilot 抽屉
  await page.getByTestId('nav-ai').click()
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-quota').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-privacy-notice').waitFor({ state: 'visible', timeout: 10000 })
  ok('顶栏 AI 按钮可打开 Copilot 抽屉并展示配额与第三方提示')

  // 快捷键 Ctrl/⌘ + J 切换关闭，再打开消息抽屉验证双向互斥
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${modKey}+j`)
  await page.getByTestId('copilot-drawer').waitFor({ state: 'hidden', timeout: 10000 })
  await page.keyboard.press(`${modKey}+j`)
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 10000 })
  ok('快捷键 Ctrl/⌘+J 可切换收起与展开 Copilot 抽屉')

  // 关闭 Copilot 后打开消息抽屉，按 Ctrl/⌘+J 互斥切入 Copilot
  await page.keyboard.press('Escape')
  await page.getByTestId('copilot-drawer').waitFor({ state: 'hidden', timeout: 10000 })
  await page.getByTestId('nav-messages').click()
  await page.getByTestId('message-drawer').waitFor({ state: 'visible', timeout: 10000 })
  await page.keyboard.press(`${modKey}+j`)
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('message-drawer').waitFor({ state: 'hidden', timeout: 10000 })
  ok('快捷键唤起 Copilot 时消息抽屉自动互斥关闭')

  // 关闭 Copilot 后重新打开消息抽屉，点「AI 速览」切入 Copilot
  await page.keyboard.press('Escape')
  await page.getByTestId('copilot-drawer').waitFor({ state: 'hidden', timeout: 10000 })
  await page.getByTestId('nav-messages').click()
  await page.getByTestId('message-drawer').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('btn-ai-unread-summary').click()
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('message-drawer').waitFor({ state: 'hidden', timeout: 10000 })
  ok('消息抽屉「AI 速览」自动切入 Copilot 抽屉并互斥关闭消息抽屉')

  // 关闭抽屉，进入帖子页验证上下文标签与「AI 总结」
  await page.keyboard.press('Escape')
  await page.getByTestId('copilot-drawer').waitFor({ state: 'hidden', timeout: 10000 })

  await page.goto(POST_PATH, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('post-page').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByTestId('nav-ai').click()
  await page.getByTestId('ai-context-pill').waitFor({ state: 'visible', timeout: 10000 })
  const pillText = (await page.getByTestId('ai-context-pill').textContent()) ?? ''
  if (pillText.includes(POST_ID)) {
    ok('帖子页 Copilot 上下文标签正确识别当前帖子 ID')
  } else {
    ng('帖子页上下文标签未含 postId', pillText)
  }

  await page.getByTestId('ai-context-dismiss').click()
  await page.getByTestId('ai-context-pill').waitFor({ state: 'hidden', timeout: 10000 })
  ok('页面上下文标签可手动叉掉移除')

  await page.keyboard.press('Escape')
  await page.getByTestId('copilot-drawer').waitFor({ state: 'hidden', timeout: 10000 })

  await page.getByTestId('btn-ai-summarize').click()
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('ai-msg-assistant').first().waitFor({ state: 'visible', timeout: 20000 })
  ok('帖子页「AI 总结」打开抽屉并渲染响应槽位（无密钥时优雅降级）')

  // 发帖页内联帮写（不发服务端创建请求）
  await page.keyboard.press('Escape')
  await page.goto(NEW_POST_PATH, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('new-post-page').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByTestId('field-post-title').fill('浏览器帮写草稿标题')

  let postMutateCount = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/content\/posts$/.test(req.url())) {
      postMutateCount += 1
    }
  })

  await page.getByTestId('ai-compose-bar-post').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('btn-ai-compose-polish').click()
  await page.getByTestId('ai-compose-preview').waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.getByTestId('ai-compose-discard').click()
  await page.getByTestId('ai-compose-preview').waitFor({ state: 'hidden', timeout: 10000 })

  if (postMutateCount === 0) {
    ok('发帖页内联「AI 帮写」弹出流式预览且未产生服务端发帖写请求')
  } else {
    ng('内联帮写意外触发了发帖请求', String(postMutateCount))
  }

  if (userErrors.length === 0) ok('登录用户全链路零未捕获异常与非预期报错')
  else ng('登录用户路径出现报错', userErrors.join('; '))
} finally {
  if (guestCtx) await guestCtx.close().catch(() => {})
  if (userCtx) await userCtx.close().catch(() => {})
  await browser.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n  浏览器断言：通过 ${String(results.length - failed.length)}，失败 ${String(failed.length)}`)
if (failed.length > 0) process.exit(1)
