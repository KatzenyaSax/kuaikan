// P9 浏览器端到端验收：相关帖子推荐、/me 个人 AI 档案与私密笔记 Tab、Copilot 范围切换。
//
//   node web/e2e/p9-kb.mjs
//
// 由 deploy/bin/verify-p9.sh 的 L3 调用。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const SITE_IP = process.env.E2E_SITE_IP
const USER_EMAIL = process.env.E2E_USER_EMAIL
const USER_PASSWORD = process.env.E2E_USER_PASSWORD
const COMMUNITY = process.env.E2E_COMMUNITY
const RELATED_POST_PATH =
  process.env.E2E_RELATED_POST_PATH ?? '/c/Rust%20%E4%B8%AD%E6%96%87/p/2121868195117584385'

for (const [k, v] of Object.entries({
  E2E_USER_EMAIL: USER_EMAIL,
  E2E_USER_PASSWORD: USER_PASSWORD,
  E2E_COMMUNITY: COMMUNITY,
})) {
  if (!v) {
    console.error(`缺少环境变量：${k}`)
    process.exit(2)
  }
}

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
  for (const attempt of [
    { label: 'bundled chromium', options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } },
  ]) {
    try {
      const browser = await chromium.launch({ ...attempt.options, args })
      console.log(`  (浏览器：${attempt.label})`)
      return browser
    } catch {
      // try next
    }
  }
  throw new Error('无法启动任何可用浏览器')
}

function watchErrors(page, bucket) {
  page.on('pageerror', (e) => bucket.push(`pageerror: ${String(e.message).split('\n')[0]}`))
  page.on('response', (r) => {
    if (r.status() < 400) return
    const target = r.url()
    if (/\/api\/user\/auth\/refresh$/.test(target)) return
    if (/\/api\/notification\/stream$/.test(target)) return
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
  // 1. 游客查看帖子页「相关帖子」推荐（零 /api/ai/** 请求）
  guestCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const guest = await guestCtx.newPage()
  const guestErrors = []
  const guestAiReqs = []
  watchErrors(guest, guestErrors)
  guest.on('request', (req) => {
    if (/\/api\/ai\//.test(req.url())) guestAiReqs.push(req.url())
  })

  await guest.goto(RELATED_POST_PATH, { waitUntil: 'networkidle' })
  await guest.getByTestId('related-posts').waitFor({ state: 'visible', timeout: 15000 })
  const relatedCount = await guest.getByTestId('related-post-item').count()
  if (relatedCount >= 1 && relatedCount <= 5) {
    ok(`游客帖子页展示相关帖子推荐（${String(relatedCount)} 篇）`)
  } else {
    ng('游客帖子页相关帖子数量异常', String(relatedCount))
  }
  if (guestAiReqs.length === 0 && guestErrors.length === 0) {
    ok('游客帖子页零 /api/ai/** 请求且无报错')
  } else {
    ng('游客帖子页出现异常', [...guestAiReqs, ...guestErrors].join('; '))
  }

  // 2. 登录用户 /me 个人 AI 档案与私密笔记 CRUD + Copilot 范围切换
  userCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const page = await userCtx.newPage()
  const userErrors = []
  watchErrors(page, userErrors)

  await login(page, USER_EMAIL, USER_PASSWORD)

  // Copilot 范围切换：首页禁用「仅当前社群」，进入社群页启用
  await page.getByTestId('nav-ai').click()
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-scope-all').waitFor({ state: 'visible', timeout: 10000 })
  const commDisabledHome = await page.getByTestId('ai-scope-community').isDisabled()
  if (commDisabledHome) {
    ok('首页打开 Copilot 时「仅当前社群」范围按钮正确置灰禁用')
  } else {
    ng('首页 Copilot「仅当前社群」未禁用')
  }
  await page.getByTestId('ai-scope-my').click()
  ok('Copilot 可切换至「仅我的」检索范围')

  await page.goto(`/c/${encodeURIComponent(COMMUNITY)}`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('nav-ai').click()
  await page.getByTestId('copilot-drawer').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-scope-community').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="ai-scope-community"]')
      return el && !el.hasAttribute('disabled')
    },
    { timeout: 15000 },
  )
  const commDisabledInCommunity = await page.getByTestId('ai-scope-community').isDisabled()
  if (!commDisabledInCommunity) {
    await page.getByTestId('ai-scope-community').click()
    ok('进入社群页后「仅当前社群」范围按钮自动解锁可用')
  } else {
    ng('进入社群页后「仅当前社群」仍处于禁用态')
  }
  await page.keyboard.press('Escape')

  // /me 我的 AI 档案 CRUD
  await page.goto('/me', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('me-tab-profile').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('me-tab-profile').click()
  await page.getByTestId('ai-profile-panel').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-profile-category').selectOption('PREFERENCE')
  await page.getByTestId('ai-profile-content').fill('E2E浏览器档案验证条目')
  await page.getByTestId('ai-profile-save').click()
  await page.getByTestId('ai-profile-item').filter({ hasText: 'E2E浏览器档案验证条目' }).waitFor({
    state: 'visible',
    timeout: 15000,
  })
  ok('/me 我的 AI 档案可新增并立即展示')

  await page.getByTestId('ai-profile-toggle').first().click()
  await page.getByText('已停用').waitFor({ state: 'visible', timeout: 10000 })
  ok('/me 我的 AI 档案支持一键停用')

  await page.getByTestId('ai-profile-delete').first().click()
  await page.getByTestId('ai-profile-item').waitFor({ state: 'detached', timeout: 10000 })
  ok('/me 我的 AI 档案支持删除且从列表移除')

  // /me 我的笔记 CRUD + Markdown 预览 + 硬删除弹窗
  await page.getByTestId('me-tab-notes').click()
  await page.getByTestId('ai-notes-panel').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByTestId('ai-note-title').fill('E2E私密笔记标题')
  await page.getByTestId('ai-note-content').fill('# E2E一级标题\n\n这是私密笔记正文。')
  await page.getByTestId('ai-note-preview-toggle').click()
  await page.getByTestId('ai-note-preview').locator('h1', { hasText: 'E2E一级标题' }).waitFor({
    state: 'visible',
    timeout: 10000,
  })
  await page.getByTestId('ai-note-preview-toggle').click()
  await page.getByTestId('ai-note-save').click()
  await page.getByTestId('ai-note-item').filter({ hasText: 'E2E私密笔记标题' }).waitFor({
    state: 'visible',
    timeout: 15000,
  })
  ok('/me 我的笔记支持 Markdown 预览并成功新建')

  await page.getByTestId('ai-note-delete').click()
  await page.getByTestId('ai-note-delete-dialog').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByTestId('ai-note-confirm-delete').click()
  await page.getByTestId('ai-note-item').waitFor({ state: 'detached', timeout: 10000 })
  ok('/me 我的笔记支持硬删除确认并从列表彻底清除')

  if (userErrors.length === 0) {
    ok('登录用户 L3 全链路零 console/4xx-5xx 报错')
  } else {
    ng('登录用户 L3 出现报错', userErrors.join('; '))
  }
} finally {
  if (guestCtx) await guestCtx.close().catch(() => {})
  if (userCtx) await userCtx.close().catch(() => {})
  await browser.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\nL3 小计：${String(results.length - failed.length)}/${String(results.length)} 通过`)
if (failed.length > 0) process.exit(1)
