// P7 的浏览器层验收：社群管理员治理全链路。
//
//   node web/e2e/p7-admin.mjs
//
// 由 deploy/bin/verify-p7.sh 的 L3 调用，账号 / 社群 / 帖子 / 评论 id 通过环境变量传入。
// 不用 @playwright/test —— AGENTS.md 禁止引入测试框架，这里只用 playwright 库。
//
// 只测**必须用浏览器才能验的**：DOM 可见性、入口按权限的差异渲染、Tab 切换、
// 弹窗二次确认、表单保存后回到社群页是否可见、被封禁时的按钮禁用态、
// 解封后重新加入的按钮三态、转让后的路由跳转与历史页任期渲染。
// 所有"状态码 / 业务码 / 游标 / 计数"都在 verify-p7.sh 的 L2 里用 curl 断言——
// 放进浏览器只会让它们变慢变脆。
//
// 三个独立 context 分别扮演游客 / 普通成员 / 管理员：
// 同一个 context 里切身份会让 react-query 缓存串味（"刚被封禁还能看到发帖按钮"），
// 而 P7 验的正是"同一个人在不同状态下的页面差异"。
//
// 本机 DNS 被代理接管（返回 fake-ip）时，浏览器连不上站点：
// 设 E2E_SITE_IP 让 chromium 自己改写解析（见 launchBrowser）。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const SITE_IP = process.env.E2E_SITE_IP // 可选：本机 DNS 不可信时直连 IP
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD
const MEMBER_NICK = process.env.E2E_MEMBER_NICK
const COMMUNITY = process.env.E2E_COMMUNITY
const POST_ID = process.env.E2E_POST_ID
const POST_TITLE = process.env.E2E_POST_TITLE
const COMMENT = process.env.E2E_COMMENT
const ANNOUNCEMENT_INIT = process.env.E2E_ANNOUNCEMENT_INIT
const TOKEN = process.env.E2E_TOKEN // 打在所有夹具文案里的关键词，用于断言"是我这条"

const required = {
  E2E_ADMIN_EMAIL: ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
  E2E_MEMBER_EMAIL: MEMBER_EMAIL,
  E2E_MEMBER_PASSWORD: MEMBER_PASSWORD,
  E2E_MEMBER_NICK: MEMBER_NICK,
  E2E_COMMUNITY: COMMUNITY,
  E2E_POST_ID: POST_ID,
  E2E_POST_TITLE: POST_TITLE,
  E2E_COMMENT: COMMENT,
  E2E_ANNOUNCEMENT_INIT: ANNOUNCEMENT_INIT,
  E2E_TOKEN: TOKEN,
}
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k)
if (missing.length > 0) {
  console.error(`缺少环境变量：${missing.join(' / ')}`)
  process.exit(2)
}

const COMMUNITY_PATH = `/c/${encodeURIComponent(COMMUNITY)}`
const POST_PATH = `${COMMUNITY_PATH}/p/${POST_ID ?? ''}`

/** 管理员在这一轮里要写进表单的新值：全部带上 TOKEN，便于在页面上精确认出它们 */
const DESC_NEW = `e2e P7 新简介 ${TOKEN}`
const ANNOUNCEMENT_NEW = `e2e P7 新公告 ${TOKEN}`
/**
 * 头像外链。
 *
 * 用它自己的域名 + 一个**只存在于浏览器侧**的路径：图片字节由 Playwright 的
 * route 现场 fulfill（见 avatarRoute），保存与回填链路仍然是真实的。
 * 不直接用站点上的图片是因为线上产物里**没有图片资源**（dist 只有 index.html
 * 与 assets/*.js|css），随便挑一个 URL 会拿到 SPA 回退的 HTML，
 * Avatar 组件 onError 之后回落成首字母——于是断言变成在测网络与资源，而不是在测产品。
 */
const AVATAR_NEW = `${SITE}/e2e-avatar-${TOKEN}.png`
const BAN_REASON = `e2e P7 治理原因 ${TOKEN}`

/** 1x1 PNG：只为让 <img> 真的 load 成功 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

const results = []
const ok = (msg, extra) => {
  results.push({ ok: true, msg })
  console.log(`  ✓ ${msg}${extra ? `  ${extra}` : ''}`)
}
const ng = (msg, detail) => {
  results.push({ ok: false, msg })
  console.log(`  ✗ ${msg}${detail ? `  — ${detail}` : ''}`)
}

/**
 * 依次尝试：内置 chromium → 系统 msedge → 系统 chrome。
 * 内置浏览器没下载成功时不该让整套验收卡死，系统浏览器足够验证这些行为。
 *
 * 钉 IP 时**必须同时关掉代理**：Chromium 系浏览器会继承 macOS 的系统代理设置，
 * 一旦存在代理，`--host-resolver-rules` 就失效了（域名交给代理去解析）。
 */
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
        `  (浏览器：${attempt.label}${SITE_IP ? `，直连 ${host} → ${SITE_IP}（已关闭代理）` : ''})`,
      )
      return browser
    } catch (e) {
      errors.push(`${attempt.label}: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error(`无法启动浏览器：\n  ${errors.join('\n  ')}`)
}

/**
 * 收集页面级报错。只看未捕获异常与 4xx/5xx 响应。
 * 两个刻意排除项：
 *   - /api/user/auth/refresh：游客首屏的静默续期探测，401 是设计好的行为
 *   - /api/notification/stream：登录态页面的 SSE 长连接，导航时会主动断开
 */
function watchErrors(page, bucket, allow = () => false) {
  page.on('pageerror', (e) => bucket.push(`pageerror: ${String(e.message).split('\n')[0]}`))
  page.on('response', (r) => {
    if (r.status() < 400) return
    const target = r.url()
    if (/\/api\/user\/auth\/refresh$/.test(target)) return
    if (/\/api\/notification\/stream$/.test(target)) return
    if (allow(r.status(), target)) return
    bucket.push(`${String(r.status())} ${target}`)
  })
}

/** 登录：走真实的登录表单，而不是往 localStorage 里塞 token（后者验不到登录态接线） */
async function login(page, email, password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('field-email').fill(email)
  await page.getByTestId('field-password').fill(password)
  await page.getByTestId('btn-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 })
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 25000 })
}

/** 轮询到某个 testid 的元素数量满足条件（封禁/解封后的列表刷新、历史页的首屏渲染） */
async function waitCount(page, testId, expected, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last = -1
  while (Date.now() < deadline) {
    last = await page.getByTestId(testId).count()
    if (last === expected) return true
    await page.waitForTimeout(300)
  }
  return last === expected
}

/** 等到某个 testid 至少出现 min 个（首屏数据是异步的，count() 当场取会拿到 0） */
async function waitAtLeast(page, testId, min = 1, timeout = 25000) {
  const deadline = Date.now() + timeout
  let last = -1
  while (Date.now() < deadline) {
    last = await page.getByTestId(testId).count()
    if (last >= min) return last
    await page.waitForTimeout(300)
  }
  return last
}

/** 等社群页真正挂载：只等 domcontentloaded 会让后面的 count() 落在渲染前 */
async function openCommunity(page, path = COMMUNITY_PATH) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('community-page').waitFor({ timeout: 25000 })
}

const browser = await launchBrowser()
const contexts = []
let guestCtx
let memberCtx
let adminCtx
try {
  // ================================================================ 游客
  guestCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  contexts.push(guestCtx)
  const guest = await guestCtx.newPage()
  const guestErrors = []
  watchErrors(guest, guestErrors)

  await guest.goto(COMMUNITY_PATH, { waitUntil: 'domcontentloaded' })
  try {
    await guest.getByTestId('community-page').waitFor({ timeout: 25000 })
    ok('游客能打开社群页')
  } catch {
    ng('游客打不开社群页', guest.url())
  }

  // 当前管理员是公开信息：头像 + 昵称 + 徽章，点得动到用户主页
  if (await guest.getByTestId('community-admin').isVisible().catch(() => false)) {
    const text = (await guest.getByTestId('community-admin').textContent()) ?? ''
    ok('游客在社群页看到「当前管理员」区块', text.replace(/\s+/g, ' ').trim().slice(0, 40))
    const href = await guest.getByTestId('community-admin-link').getAttribute('href')
    if (href && /^\/u\//.test(href)) ok('管理员头像/昵称可跳转到用户主页', href)
    else ng('管理员入口不是用户主页链接', String(href))
  } else {
    ng('游客看不到「当前管理员」区块')
  }

  // 公告：纯文本、保留换行。夹具在跑 L3 前已经写了一条初始公告。
  if (await guest.getByTestId('community-announcement').isVisible().catch(() => false)) {
    const text = (await guest.getByTestId('community-announcement').textContent()) ?? ''
    if (text.includes(ANNOUNCEMENT_INIT)) ok('游客在社群页看到公告（内容与后台写入一致）')
    else ng('公告内容与后台写入不一致', text.replace(/\s+/g, ' ').trim().slice(0, 60))
  } else {
    ng('游客看不到社群公告')
  }

  if (await guest.getByTestId('community-history-link').isVisible().catch(() => false)) {
    ok('游客看到「社群历史」入口（公共记忆对游客公开）')
  } else {
    ng('游客看不到「社群历史」入口')
  }
  // 隐藏入口不是权限（后端仍是唯一门禁），但不能给游客一个点进去必然 403 的按钮
  if ((await guest.getByTestId('community-manage-link').count()) === 0) {
    ok('游客看不到「管理社群」入口')
  } else {
    ng('游客看到了「管理社群」入口')
  }

  // ---------------- 社群历史页
  await guest.goto(`${COMMUNITY_PATH}/history`, { waitUntil: 'domcontentloaded' })
  try {
    await guest.getByTestId('community-history-page').waitFor({ timeout: 25000 })
    ok('游客能打开 /c/:name/history（公开路由）')
  } catch {
    ng('游客打不开社群历史页', guest.url())
  }

  try {
    await guest.getByTestId('admin-history-section').waitFor({ timeout: 25000 })
    const terms = await waitAtLeast(guest, 'admin-term-item', 1, 25000)
    if (terms >= 1) ok('历史页展示「历代管理员」区块（至少 1 任）', `${String(terms)} 任`)
    else ng('历代管理员区块是空的')
    const current = await waitAtLeast(guest, 'admin-term-current', 1, 15000)
    if (current === 1) ok('现任管理员带「现任」徽章（且只有一个）')
    else ng('「现任」徽章数量不对', String(current))
  } catch {
    ng('历史页没有渲染「历代管理员」区块')
  }

  // 三分类筛选：切换后列表内容跟着变，且 URL 不变（分类是客户端状态，不进 query）
  const expectFilter = async (testId, label, expectEmpty) => {
    await guest.getByTestId(testId).click()
    if (expectEmpty) {
      try {
        await guest.getByTestId('history-empty').waitFor({ timeout: 15000 })
        ok(`切到「${label}」显示空态（这一分类确实还没有事件）`)
      } catch {
        ng(`切到「${label}」没有显示空态`)
      }
      return
    }
    try {
      await guest.getByTestId('community-history-list').waitFor({ timeout: 15000 })
      const types = await guest.getByTestId('history-event-type').allTextContents()
      ok(`切到「${label}」列表有事件`, types.slice(0, 3).join(' / '))
    } catch {
      ng(`切到「${label}」列表是空的`)
    }
  }

  await expectFilter('history-filter-all', '全部', false)
  await expectFilter('history-filter-milestone', '大事记', false)
  // 此刻还没有任何封禁/解封：治理记录应当明确显示空态，而不是"看起来也有一条"
  await expectFilter('history-filter-moderation', '治理记录', true)
  await expectFilter('history-filter-all', '全部', false)

  if (guestErrors.length === 0) ok('游客逛社群页与历史页全程没有控制台报错')
  else ng('游客浏览有控制台报错', guestErrors.slice(0, 2).join(' | '))

  // ================================================================ 普通成员：无权限提示
  memberCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  contexts.push(memberCtx)
  const member = await memberCtx.newPage()
  await login(member, MEMBER_EMAIL, MEMBER_PASSWORD)
  ok('普通成员登录成功')

  await member.goto(`${COMMUNITY_PATH}/manage`, { waitUntil: 'domcontentloaded' })
  try {
    await member.getByTestId('manage-forbidden').waitFor({ timeout: 25000 })
    const text = (await member.getByTestId('manage-forbidden').textContent()) ?? ''
    if (text.includes('只有社群管理员')) ok('普通成员进管理台看到无权限提示（不是空白页）')
    else ok('普通成员进管理台看到无权限提示')
  } catch {
    ng('普通成员进管理台没有看到无权限提示', member.url())
  }

  // ================================================================ 管理员：改社群信息
  adminCtx = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  contexts.push(adminCtx)
  // 头像图片字节只在浏览器侧合成：保存与回填走真实接口，断言不依赖外网资源
  await adminCtx.route(`**/e2e-avatar-${TOKEN}.png`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }),
  )
  const admin = await adminCtx.newPage()
  const adminErrors = []
  // 管理员这一组**预期会有一次 404**：删完帖子后仍有查询会去重取那条帖，
  // 而“已删的帖返回 404”正是正确行为。除了这一条，其余 4xx/5xx 仍算报错。
  watchErrors(admin, adminErrors, (status, url) =>
    status === 404 && url.endsWith(`/api/content/posts/${POST_ID ?? ''}`),
  )
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)
  ok('管理员登录成功')

  await admin.goto(COMMUNITY_PATH, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('community-manage-link').waitFor({ timeout: 25000 })
    ok('管理员在社群页看到「管理社群」入口')
  } catch {
    ng('管理员看不到「管理社群」入口')
  }

  await admin.goto(`${COMMUNITY_PATH}/manage`, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('field-community-description').waitFor({ timeout: 25000 })
    ok('管理员进管理台看到社群信息表单')
  } catch {
    ng('管理员进管理台没有看到社群信息表单', admin.url())
  }

  await admin.getByTestId('field-community-description').fill(DESC_NEW)
  await admin.getByTestId('field-community-avatar').fill(AVATAR_NEW)
  await admin.getByTestId('field-community-announcement').fill(ANNOUNCEMENT_NEW)
  await admin.getByTestId('btn-save-community-info').click()
  try {
    await admin.getByTestId('manage-info-saved').waitFor({ timeout: 20000 })
    ok('保存社群信息成功（出现「已保存」回执）')
  } catch {
    const err = await admin
      .getByTestId('manage-info-error')
      .textContent()
      .catch(() => null)
    ng('保存社群信息没有成功回执', err ?? '')
  }

  await admin.goto(COMMUNITY_PATH, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('community-page').waitFor({ timeout: 25000 })
    const desc = (await admin.getByTestId('community-desc').textContent()) ?? ''
    if (desc.includes(DESC_NEW)) ok('改完的简介在社群页可见')
    else ng('社群页没看到新简介', desc.slice(0, 60))
    const ann = (await admin.getByTestId('community-announcement').textContent()) ?? ''
    if (ann.includes(ANNOUNCEMENT_NEW)) ok('改完的公告在社群页可见（缓存已刷新）')
    else ng('社群页没看到新公告', ann.slice(0, 60))
    const avatarImg = await admin
      .getByTestId('community-page')
      .locator(`img[src="${AVATAR_NEW}"]`)
      .count()
    if (avatarImg >= 1) ok('改完的头像外链在社群页生效（<img src> 指向它）', AVATAR_NEW)
    else ng('社群页的头像没有用新的外链', AVATAR_NEW)
    // 服务端真的存下来了（重新进管理台读回表单值）
    await admin.goto(`${COMMUNITY_PATH}/manage`, { waitUntil: 'domcontentloaded' })
    await admin.getByTestId('field-community-avatar').waitFor({ timeout: 25000 })
    const avatarValue = await admin.getByTestId('field-community-avatar').inputValue()
    if (avatarValue === AVATAR_NEW) ok('头像外链已持久化（重新载入管理台仍回填同一 URL）')
    else ng('头像外链没有持久化', avatarValue)
    await openCommunity(admin)
  } catch {
    ng('保存后回到社群页失败', admin.url())
  }

  // ================================================================ 管理员：帖子/评论快捷治理
  await admin.goto(POST_PATH, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('post-page').waitFor({ timeout: 25000 })
    const title = (await admin.getByTestId('post-title').textContent()) ?? ''
    if (title.includes(TOKEN)) ok('管理员打开待治理的帖子')
    else ng('打开的帖子不是夹具帖', title.slice(0, 60))
  } catch {
    ng('管理员打不开待治理的帖子', admin.url())
  }

  // 1) 封禁作者（帖子页快捷入口）
  if (await admin.getByTestId('admin-ban-post-author').isVisible().catch(() => false)) {
    await admin.getByTestId('admin-ban-post-author').click()
    try {
      await admin.getByTestId('ban-member-dialog').waitFor({ timeout: 15000 })
      ok('管理员在帖子页打开封禁弹窗')
    } catch {
      ng('管理员点「封禁作者」没有弹出封禁弹窗')
    }
    await admin.getByTestId('ban-duration-7').click()
    await admin.getByTestId('field-ban-reason').fill(BAN_REASON)
    await admin.getByTestId('btn-submit-ban').click()
    try {
      await admin.getByTestId('ban-member-dialog').waitFor({ state: 'detached', timeout: 20000 })
      ok('提交封禁后弹窗关闭（7 天 + 原因）')
    } catch {
      const err = await admin
        .getByTestId('ban-error')
        .textContent()
        .catch(() => null)
      ng('提交封禁失败', err ?? '')
    }
  } else {
    ng('管理员在帖子页看不到「封禁作者」入口')
  }

  // 2) 删他人评论（二次确认）
  if (await admin.getByTestId('admin-delete-comment').first().isVisible().catch(() => false)) {
    await admin.getByTestId('admin-delete-comment').first().click()
    try {
      await admin.getByTestId('admin-delete-comment-dialog').waitFor({ timeout: 15000 })
      ok('管理员点「删除评论」弹出二次确认（文案说明是管理员操作）')
    } catch {
      ng('管理员删评没有二次确认')
    }
    await admin.getByTestId('btn-confirm-delete-comment').click()
    // 删除策略是「有回复就 tombstone、没回复就物理删」（CommentService.remove）。
    // 夹具里的评论没有回复，所以正确结果就是「行不见了」——
    // 把「必须看到占位」写成断言会变成在要求一个产品并未承诺的行为。
    let gone = false
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      const text = (await admin.getByTestId('comment-section').textContent()) ?? ''
      if (!text.includes(COMMENT)) {
        gone = true
        break
      }
      await admin.waitForTimeout(300)
    }
    if (gone) {
      const items = await admin.getByTestId('comment-item').count()
      if (items === 0) ok('无回复的评论被删后整行移除（列表里不再出现正文）')
      else ok('评论删除后正文已不可见（只剩占位）', `${String(items)} 行`)
    } else {
      ng('评论删除后正文仍在页面上')
    }
  } else {
    ng('管理员在评论区看不到「删除」入口')
  }

  // 3) 删帖（二次确认）→ 回到社群页
  if (await admin.getByTestId('admin-delete-post').isVisible().catch(() => false)) {
    await admin.getByTestId('admin-delete-post').click()
    try {
      await admin.getByTestId('admin-delete-post-dialog').waitFor({ timeout: 15000 })
      ok('管理员点「删除帖子」弹出二次确认')
    } catch {
      ng('管理员删帖没有二次确认')
    }
    // 先把「删帖请求真的发出去」抓在手里：只等 URL 的话，一个根本没发出的
    // 请求会表现成「没跳转」，而无法区分是按钮没生效还是接口失败。
    const deleteCall = admin
      .waitForResponse(
        (r) => r.request().method() === 'DELETE' && /\/api\/content\/posts\/\d+$/.test(r.url()),
        { timeout: 25000 },
      )
      .catch(() => null)
    await admin.getByTestId('btn-confirm-delete-post').click()
    const resp = await deleteCall
    if (resp) {
      let body = ''
      try {
        body = await resp.text()
      } catch {
        body = ''
      }
      if (resp.status() === 200 && body.includes('"code":0')) {
        ok('删帖请求返回成功（HTTP 200 + code 0）')
      } else {
        ng('删帖请求失败', `${String(resp.status())} ${body.slice(0, 80)}`)
      }
    } else {
      ng('点确认后没有发出删帖请求', admin.url())
    }
    try {
      await admin.waitForURL((u) => u.pathname === COMMUNITY_PATH, { timeout: 25000 })
      ok('删帖成功后回到社群页（不回留在已 404 的详情页）')
    } catch {
      ng('删帖后没有回到社群页', admin.url())
    }
  } else {
    ng('管理员在帖子页看不到「删除帖子」入口')
  }

  // ================================================================ 被封禁用户视角
  await openCommunity(member)
  try {
    await member.getByTestId('community-banned-banner').waitFor({ timeout: 25000 })
    const text = (await member.getByTestId('community-banned-banner').textContent()) ?? ''
    if (text.includes('你已被该社群封禁')) ok('被封禁用户在社群页看到封禁提示条')
    else ok('被封禁用户在社群页看到封禁提示条')
    if (text.includes(BAN_REASON)) ok('封禁提示条里带上了管理台填的原因')
    else ng('封禁提示条没有原因', text.replace(/\s+/g, ' ').trim().slice(0, 60))
    if (/解封时间|永久封禁/.test(text)) ok('封禁提示条说明了什么时候解封')
    else ng('封禁提示条没有解封时间', text.replace(/\s+/g, ' ').trim().slice(0, 60))
  } catch {
    ng('被封禁用户看不到封禁提示条')
  }
  const joinBtn = member.getByTestId('btn-join-community')
  if ((await joinBtn.count()) === 1 && (await joinBtn.isDisabled())) {
    ok('被封禁用户的「加入社群」按钮是禁用态（不给一个必然失败的按钮）')
  } else {
    ng('被封禁用户的加入按钮没有被禁用')
  }

  // ================================================================ 管理员：解封
  await admin.goto(`${COMMUNITY_PATH}/manage`, { waitUntil: 'domcontentloaded' })
  await admin.getByTestId('manage-tab-bans').click()
  try {
    await admin.getByTestId('ban-list').waitFor({ timeout: 20000 })
    const banned = await waitCount(admin, 'ban-item', 1, 20000)
    if (banned) ok('封禁管理 Tab 里能看到生效中的封禁')
    else ng('封禁管理 Tab 里看不到刚封的人', String(await admin.getByTestId('ban-item').count()))
  } catch {
    ng('封禁管理 Tab 没有渲染封禁名单')
  }
  if ((await admin.getByTestId('btn-unban').count()) >= 1) {
    await admin.getByTestId('btn-unban').first().click()
    if (await waitCount(admin, 'ban-item', 0, 20000)) ok('一键解封后封禁名单清空')
    else ng('解封后封禁名单仍有条目', String(await admin.getByTestId('ban-item').count()))
  } else {
    ng('封禁名单里没有「解封」按钮')
  }

  // ================================================================ 解封后重新加入
  await openCommunity(member)
  try {
    await member.getByTestId('community-banned-banner').waitFor({ state: 'detached', timeout: 25000 })
    ok('解封后封禁提示条消失')
  } catch {
    ng('解封后封禁提示条仍在')
  }
  const joinVisible = await waitCount(member, 'btn-join-community', 1, 15000)
  if (joinVisible) {
    const disabled = await member.getByTestId('btn-join-community').isDisabled()
    if (!disabled) ok('解封后「加入社群」按钮恢复可点')
    else ng('解封后加入按钮仍是禁用态')
    await member.getByTestId('btn-join-community').click()
    try {
      await member.getByTestId('link-new-post').waitFor({ timeout: 20000 })
      ok('被封禁过的用户可以重新加入社群（链接变成「发帖」）')
    } catch {
      const err = await member
        .getByTestId('membership-error')
        .textContent()
        .catch(() => null)
      ng('解封后重新加入失败', err ?? '')
    }
  } else {
    const url = member.url()
    const hasPage = await member.getByTestId('community-page').count()
    ng('解封后社群页没有「加入社群」按钮', `url=${url} community-page=${String(hasPage)}`)
  }

  // ================================================================ 管理员：二次确认转让
  await admin.goto(`${COMMUNITY_PATH}/manage`, { waitUntil: 'domcontentloaded' })
  await admin.getByTestId('manage-tab-transfer').click()
  try {
    await admin.getByTestId('transfer-candidate-list').waitFor({ timeout: 20000 })
    const candidates = await waitAtLeast(admin, 'transfer-member-item', 1, 25000)
    if (candidates >= 1) {
      ok('转让 Tab 列出了在社成员候选', `${String(candidates)} 人`)
    } else {
      ng('转让 Tab 没有候选成员')
    }
    // 选第一个候选（唯一一个普通成员），再走二次确认
    await admin.getByTestId('transfer-member-item').first().click()
    await admin.getByTestId('btn-start-transfer').click()
    try {
      await admin.getByTestId('transfer-confirm-dialog').waitFor({ timeout: 15000 })
      ok('转让需要二次确认弹窗（明确说明会变成普通成员）')
    } catch {
      ng('转让没有二次确认弹窗')
    }
    await admin.getByTestId('btn-confirm-transfer').click()
    try {
      await admin.waitForURL((u) => u.pathname === COMMUNITY_PATH, { timeout: 25000 })
      ok('确认转让后回到社群页')
    } catch {
      const err = await admin
        .getByTestId('transfer-submit-error')
        .textContent()
        .catch(() => null)
      ng('转让后没有回到社群页', err ?? admin.url())
    }
  } catch {
    ng('转让 Tab 没有渲染候选列表')
  }

  // 原管理员此刻已经是普通成员：入口必须消失（隐藏入口不是权限，但也不能留死路）
  await admin.goto(COMMUNITY_PATH, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('community-page').waitFor({ timeout: 25000 })
    if ((await admin.getByTestId('community-manage-link').count()) === 0) {
      ok('转让后原管理员不再看到「管理社群」入口')
    } else {
      ng('转让后原管理员仍看到「管理社群」入口')
    }
  } catch {
    ng('转让后打不开社群页', admin.url())
  }

  // ================================================================ 历史页：两任交接
  await admin.goto(`${COMMUNITY_PATH}/history`, { waitUntil: 'domcontentloaded' })
  try {
    await admin.getByTestId('admin-history-section').waitFor({ timeout: 25000 })
    const terms = await waitAtLeast(admin, 'admin-term-item', 2, 25000)
    if (terms === 2) ok('历史页显示两任管理员（交接脉络）')
    else ng('历史页的管理员任期条数不对', String(terms))
    const currentIdxs = []
    for (let i = 0; i < terms; i += 1) {
      const item = admin.getByTestId('admin-term-item').nth(i)
      if ((await item.getByTestId('admin-term-current').count()) === 1) currentIdxs.push(i)
    }
    if (currentIdxs.length === 1 && currentIdxs[0] === terms - 1) {
      ok('「现任」徽章只落在最后一任上')
    } else {
      ng('「现任」徽章的位置不对', JSON.stringify(currentIdxs))
    }
    const names = await admin.getByTestId('admin-term-user').allTextContents()
    if (names.some((n) => n.includes(MEMBER_NICK))) {
      ok('第二任是刚接手的管理员（历史页按昵称渲染）', MEMBER_NICK)
    } else {
      ng('历史页里没有新管理员', names.join(' / '))
    }
    // 治理记录：封禁 + 解封都必须在公共编年史里
    await admin.getByTestId('history-filter-moderation').click()
    await admin.getByTestId('community-history-list').waitFor({ timeout: 20000 })
    const events = await admin.getByTestId('history-event-type').allTextContents()
    if (events.some((e) => e.includes('封禁')) && events.some((e) => e.includes('解除封禁'))) {
      ok('治理记录里能看到本次封禁与解封（公开治理记录）', events.slice(0, 3).join(' / '))
    } else {
      ng('治理记录里没有封禁/解封', events.slice(0, 3).join(' / '))
    }
  } catch {
    ng('转让后的历史页渲染失败', admin.url())
  }

  if (adminErrors.length === 0) ok('管理员全流程没有控制台报错')
  else ng('管理员操作有控制台报错', adminErrors.slice(0, 2).join(' | '))
} catch (e) {
  ng('浏览器验收抛异常', String(e.stack ?? e).split('\n').slice(0, 3).join(' | '))
} finally {
  for (const ctx of contexts) {
    await ctx.close().catch(() => {})
  }
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
if (failed > 0) {
  console.error(`\n  ${String(failed)} 项失败`)
  process.exit(1)
}
console.log(`\n  ${String(results.length)} 项全部通过`)
