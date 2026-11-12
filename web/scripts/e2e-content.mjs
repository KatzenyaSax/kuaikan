// P2.4 的浏览器验收：双栏布局、URL 即状态、窄屏降级、游标加载更多。
//
//   node web/scripts/e2e-content.mjs
//
// 由 deploy/bin/verify-p2.sh 的 L3 调用，账号与站点通过环境变量传入。
// 不用 @playwright/test —— AGENTS.md 禁止单元测试框架，这里只用 playwright 库。
//
// 只测**必须用浏览器才能验的**：DOM 可见性、路由跳转、后退语义、断点。
// 能用 curl 验的（状态码、业务码、分页正确性）都在 verify-p2.sh 的 L2 里，
// 放进浏览器只是让它们变慢变脆。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const COMMUNITY = process.env.E2E_COMMUNITY

if (!EMAIL || !PASSWORD || !COMMUNITY) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD / E2E_COMMUNITY')
  process.exit(2)
}

const results = []
const ok = (msg) => { results.push({ ok: true, msg }); console.log(`  ✓ ${msg}`) }
const ng = (msg, detail) => { results.push({ ok: false, msg }); console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`) }

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge' })
const ctx = await browser.newContext({ baseURL: SITE })
const page = await ctx.newPage()

try {
  // ---------- 准备：登录 + 建社群 + 发 25 帖 ----------
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('field-email').fill(EMAIL)
  await page.getByTestId('field-password').fill(PASSWORD)
  await page.getByTestId('btn-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })

  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByTestId('btn-new-community').click()
  await page.getByTestId('field-community-name').fill(COMMUNITY)
  await page.getByTestId('btn-create-community-submit').click()
  await page.waitForURL((u) => u.pathname.startsWith('/c/'), { timeout: 15000 })
  const base = new URL(page.url()).pathname

  // 帖子用接口灌（25 条走 UI 太慢，而且发的动作已经在 P2.3 验过）
  const token = await page.evaluate(async () => {
    const r = await fetch('/api/user/auth/refresh', { method: 'POST', credentials: 'include' })
    const j = await r.json()
    return j?.data?.accessToken ?? null
  })
  if (!token) throw new Error('拿不到 access token')
  const communityId = await page.evaluate(async (name) => {
    const r = await fetch(`/api/community/communities/${encodeURIComponent(name)}`)
    const j = await r.json()
    return j?.data?.id ?? null
  }, COMMUNITY)
  if (!communityId) throw new Error('拿不到 communityId')

  for (let i = 1; i <= 25; i += 1) {
    await page.evaluate(
      async ({ token, communityId, i }) => {
        await fetch('/api/content/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ communityId, title: `e2e 帖 ${i}`, body: `正文 ${i}` }),
        })
      },
      { token, communityId, i },
    )
  }
  ok('准备：登录 + 建社群 + 25 帖')

  // ---------- 双栏 ----------
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByTestId('post-list').waitFor({ timeout: 15000 })
  const leftBox = await page.getByTestId('left-pane').boundingBox()
  const rightBox = await page.getByTestId('right-pane').boundingBox()
  if (leftBox && rightBox && leftBox.x < rightBox.x && leftBox.width > 200) {
    ok(`桌面端双栏并排（左 ${Math.round(leftBox.width)}px / 右 ${Math.round(rightBox.width)}px）`)
  } else {
    ng('桌面端不是双栏', JSON.stringify({ leftBox, rightBox }))
  }
  if ((await page.getByTestId('community-name').count()) > 0) ok('右栏空态是社群概览')
  else ng('右栏空态不是社群概览')

  // ---------- 点帖子：右栏换内容、URL 变化、左栏不消失 ----------
  const first = page.getByTestId('post-list-item').first()
  const firstHref = await first.getAttribute('href')
  await first.click()
  await page.getByTestId('post-page').waitFor({ timeout: 15000 })
  if (new URL(page.url()).pathname.includes('/p/')) ok('点帖子后 URL 变成 /c/:name/p/:postId')
  else ng('点帖子后 URL 没变', page.url())
  if ((await page.getByTestId('post-list').count()) > 0) ok('切帖子后左栏仍在（右栏换内容而非整页跳转）')
  else ng('切帖子后左栏消失了')

  // ---------- 后退 ----------
  await page.goBack()
  await page.getByTestId('community-name').waitFor({ timeout: 15000 })
  if (new URL(page.url()).pathname === base) ok('浏览器后退回到社群概览')
  else ng('后退语义不对', page.url())

  // ---------- 冷启动深链接 ----------
  const fresh = await ctx.newPage()
  await fresh.goto(firstHref, { waitUntil: 'networkidle' })
  await fresh.getByTestId('post-page').waitFor({ timeout: 15000 })
  const bothPanes =
    (await fresh.getByTestId('post-list-item').count()) > 0 &&
    (await fresh.getByTestId('post-title').count()) > 0
  if (bothPanes) ok('冷启动直开帖子链接：两栏都有数据')
  else ng('冷启动深链接缺数据')
  await fresh.close()

  // ---------- 滚到底自动加载第二页 ----------
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByTestId('post-list').waitFor({ timeout: 15000 })
  const before = await page.getByTestId('post-list-item').count()
  await page.getByTestId('post-list-item').last().scrollIntoViewIfNeeded()
  // 等观察器与第二次请求
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="post-list-item"]').length > n,
    before,
    { timeout: 15000 },
  )
  const after = await page.getByTestId('post-list-item').count()
  if (after > before) ok(`滚到底自动加载更多（${before} → ${after} 条）`)
  else ng('滚到底没有加载更多')

  // ---------- 窄屏降级 ----------
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByTestId('left-pane').waitFor({ timeout: 15000 })
  if ((await page.getByTestId('left-pane').isVisible()) &&
      !(await page.getByTestId('right-pane').isVisible())) {
    ok('375px 社群页只显示列表（右栏隐藏）')
  } else {
    ng('375px 社群页没有降级成单栏')
  }
  await page.getByTestId('post-list-item').first().click()
  await page.getByTestId('post-page').waitFor({ timeout: 15000 })
  if ((await page.getByTestId('right-pane').isVisible()) &&
      !(await page.getByTestId('left-pane').isVisible())) {
    ok('375px 帖子页只显示正文（左栏隐藏）')
  } else {
    ng('375px 帖子页没有降级成单栏')
  }
} catch (e) {
  ng('浏览器验收抛异常', String(e).split('\n')[0])
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
if (failed > 0) {
  console.error(`\n  ${failed} 项失败`)
  process.exit(1)
}
console.log(`\n  ${results.length} 项全部通过`)
