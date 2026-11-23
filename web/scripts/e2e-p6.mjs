// P6 的浏览器层验收：顶栏搜索跳转 / 高亮渲染 / 排序切换 / 社群筛选 / 空态 / 点结果进详情。
//
//   node web/scripts/e2e-p6.mjs
//
// 由 deploy/bin/verify-p6.sh 的 L3 调用，夹具 id 与关键词通过环境变量传入。
// 不走 `npm run e2e:p6`：本阶段只允许新增验收脚本，不动 web/package.json。
// 不用 @playwright/test —— AGENTS.md 禁止引入测试框架，这里只用 playwright 库。
//
// 只测**必须用浏览器才能验的**：DOM 可见性、`<mark>` 是否真的被渲染成元素、
// 后端下发的占位符有没有漏到页面上、URL 参数与筛选控件的联动、路由跳转。
// 所有"状态码 / 业务码 / 游标正确性 / 排序稳定性"都在 verify-p6.sh 的 L2 里用 curl 断言——
// 放进浏览器只会让它们变慢变脆。
//
// 本机 DNS 被代理接管（返回 fake-ip）时，浏览器连不上站点：
// 设 E2E_SITE_IP 让 chromium 自己改写解析（见 launchBrowser）。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const SITE_IP = process.env.E2E_SITE_IP // 可选：本机 DNS 不可信时直连 IP
const TOKEN = process.env.E2E_TOKEN
const COMMUNITY = process.env.E2E_COMMUNITY
const COMMUNITY_ID = process.env.E2E_COMMUNITY_ID
const POST_ID = process.env.E2E_POST_ID
const POST_TITLE = process.env.E2E_POST_TITLE
const XSS_MARK = process.env.E2E_XSS_MARK // 帖子里那串"看起来像标签"的字面量

const required = {
  E2E_TOKEN: TOKEN,
  E2E_COMMUNITY: COMMUNITY,
  E2E_COMMUNITY_ID: COMMUNITY_ID,
  E2E_POST_ID: POST_ID,
  E2E_POST_TITLE: POST_TITLE,
  E2E_XSS_MARK: XSS_MARK,
}
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k)
if (missing.length > 0) {
  console.error(`缺少环境变量：${missing.join(' / ')}`)
  process.exit(2)
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

/** 后端与前端约定的高亮占位符（Unicode 私用区），漏到页面上就是渲染 bug */
const OPEN = '\uE000'
const CLOSE = '\uE001'

/**
 * 依次尝试：内置 chromium → 系统 msedge → 系统 chrome。
 * 内置浏览器没下载成功时不该让整套验收卡死，系统浏览器足够验证这些行为。
 */
async function launchBrowser() {
  const host = new URL(SITE).hostname
  const args = SITE_IP ? [`--host-resolver-rules=MAP ${host} ${SITE_IP}`] : []
  const attempts = [
    { label: 'bundled chromium', options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } },
  ]
  const errors = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({ ...attempt.options, args })
      console.log(`  (浏览器：${attempt.label}${SITE_IP ? `，解析 ${host} → ${SITE_IP}` : ''})`)
      return browser
    } catch (e) {
      errors.push(`${attempt.label}: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error(`无法启动浏览器：\n  ${errors.join('\n  ')}`)
}

/**
 * 收集页面级报错。只看三类：未捕获异常、4xx/5xx 响应。
 * 刻意排除 /api/user/auth/refresh：游客首屏的静默续期探测，401 是设计好的行为。
 */
function watchErrors(page, bucket) {
  page.on('pageerror', (e) => bucket.push(`pageerror: ${String(e.message).split('\n')[0]}`))
  page.on('response', (r) => {
    if (r.status() < 400) return
    const target = r.url()
    if (/\/api\/user\/auth\/refresh$/.test(target)) return
    bucket.push(`${String(r.status())} ${target}`)
  })
}

/** 搜索结果列表里的可见文字（高频用于"有没有那条帖"的断言） */
async function resultsText(page) {
  return (await page.getByTestId('search-result-list').textContent()) ?? ''
}

const browser = await launchBrowser()

let context
try {
  context = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  watchErrors(page, errors)

  // ================================================================ 顶栏搜索
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const topbar = page.getByTestId('topbar-search-input')
  await topbar.waitFor({ state: 'visible', timeout: 20000 })
  ok('游客首页顶栏有搜索输入框')

  await topbar.fill(TOKEN)
  await topbar.press('Enter')
  try {
    await page.waitForURL((u) => u.pathname === '/search' && u.searchParams.get('q') === TOKEN, {
      timeout: 20000,
    })
    ok('顶栏回车跳到 /search?q=<关键词>', TOKEN)
  } catch {
    ng('顶栏搜索没有跳到 /search', page.url())
  }

  await page.getByTestId('search-page').waitFor({ timeout: 20000 })
  await page.getByTestId('search-result-list').waitFor({ timeout: 20000 })
  const text = await resultsText(page)
  if (text.includes(TOKEN)) ok('搜索结果里出现了刚发的那条帖')
  else ng('搜索结果里没有目标帖', text.slice(0, 80))

  // ================================================================ 高亮渲染
  const markCount = await page.getByTestId('search-result-list').locator('mark').count()
  if (markCount >= 1) ok('命中词被渲染成 <mark> 元素', `${String(markCount)} 个`)
  else ng('命中的关键词没有渲染成 <mark>')

  let leaked = false
  if (text.includes(OPEN) || text.includes(CLOSE)) leaked = true
  if (text.includes('<mark>')) leaked = true
  if (leaked) ng('页面上出现了裸占位符或裸 HTML 标签')
  else ok('页面上没有裸占位符 / 裸 HTML 标签')

  // 后端只下发文本 + 私用区占位符：正文里像标签的东西必须被当文字画出来
  const xssFired = await page.evaluate(() => window.__p6xss ?? null)
  if (xssFired === null) ok('正文里的 HTML 字面量没有执行（无 XSS）')
  else ng('正文里的 HTML 被执行了', String(xssFired))
  if (text.includes(XSS_MARK)) ok('正文里的 HTML 字面量按纯文本渲染', XSS_MARK.slice(0, 24))
  else ng('正文里的 HTML 字面量没有被当文本渲染', text.slice(0, 80))

  // ================================================================ 排序切换
  await page.getByTestId('search-sort-latest').click()
  try {
    await page.waitForURL((u) => u.searchParams.get('sort') === 'latest', { timeout: 15000 })
    await page.getByTestId('search-result-list').waitFor({ timeout: 15000 })
    if ((await resultsText(page)).includes(POST_TITLE)) ok('切到「最新」后结果仍在（URL 带 sort=latest）')
    else ng('切到「最新」后结果空了', (await resultsText(page)).slice(0, 80))
  } catch {
    ng('点「最新」没有把 sort=latest 写进 URL', page.url())
  }

  await page.getByTestId('search-sort-relevance').click()
  try {
    await page.waitForURL((u) => (u.searchParams.get('sort') ?? 'relevance') === 'relevance', {
      timeout: 15000,
    })
    ok('切回「相关性」URL 参数复位')
  } catch {
    ng('切回「相关性」URL 没有复位', page.url())
  }

  // ================================================================ 社群筛选
  const select = page.getByTestId('search-community-select')
  await select.selectOption(COMMUNITY_ID)
  try {
    await page.waitForURL((u) => u.searchParams.get('communityId') === COMMUNITY_ID, {
      timeout: 15000,
    })
    await page.getByTestId('search-result-list').waitFor({ timeout: 15000 })
    const filtered = await resultsText(page)
    if (filtered.includes(TOKEN) && filtered.includes(COMMUNITY)) {
      ok('按社群筛选后只剩该社群的结果', COMMUNITY)
    } else {
      ng('社群筛选后结果不对', filtered.slice(0, 80))
    }
  } catch {
    ng('选社群没有把 communityId 写进 URL', page.url())
  }

  // ================================================================ 空态 / 引导态
  const noHit = `zzz-no-hit-${String(Date.now())}`
  await page.goto(`/search?q=${encodeURIComponent(noHit)}`, { waitUntil: 'domcontentloaded' })
  try {
    await page.getByTestId('search-empty').waitFor({ timeout: 20000 })
    const emptyText = (await page.getByTestId('search-empty').textContent()) ?? ''
    if (emptyText.includes(noHit)) ok('无结果时渲染空态（文案带上关键词）')
    else ok('无结果时渲染空态')
  } catch {
    ng('无结果时没有渲染空态')
  }

  await page.goto('/search', { waitUntil: 'domcontentloaded' })
  try {
    await page.getByTestId('search-hint').waitFor({ timeout: 20000 })
    ok('没有 q 时渲染「输入关键词」引导态，而不是发一次空查询')
  } catch {
    ng('没有 q 时没有渲染引导态')
  }

  // ================================================================ 点结果进详情
  await page.goto(`/search?q=${encodeURIComponent(TOKEN)}&sort=latest`, {
    waitUntil: 'domcontentloaded',
  })
  await page.getByTestId('search-result-list').waitFor({ timeout: 20000 })
  const target = page.locator('[data-testid="search-result-item"]', { hasText: POST_TITLE }).first()
  if ((await target.count()) === 0) {
    ng('结果列表里找不到目标帖，无法验证跳转')
  } else {
    await target.getByRole('link').click()
    try {
      await page.waitForURL(
        (u) =>
          u.pathname === `/c/${encodeURIComponent(COMMUNITY)}/p/${POST_ID}` ||
          u.pathname.endsWith(`/p/${POST_ID}`),
        { timeout: 20000 },
      )
      await page.getByTestId('post-page').waitFor({ timeout: 20000 })
      ok('点搜索结果进帖子详情页', page.url())
    } catch {
      ng('点搜索结果没有进详情页', page.url())
    }
  }

  if (errors.length === 0) ok('游客搜索全程没有控制台报错')
  else ng('游客搜索有控制台报错', errors.slice(0, 2).join(' | '))
} catch (e) {
  ng('浏览器验收抛异常', String(e.stack ?? e).split('\n').slice(0, 3).join(' | '))
} finally {
  if (context) await context.close().catch(() => {})
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
if (failed > 0) {
  console.error(`\n  ${String(failed)} 项失败`)
  process.exit(1)
}
console.log(`\n  ${String(results.length)} 项全部通过`)
