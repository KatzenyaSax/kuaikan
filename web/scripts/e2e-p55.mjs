// P5.5 的浏览器层验收：关注 / 用户主页 / 关注流 / 关注消息 / 我的收藏 / 修改密码。
//
//   node web/scripts/e2e-p55.mjs
//
// 由 deploy/bin/verify-p55.sh 的 L3 调用，账号与夹具 id 通过环境变量传入。
// 不用 @playwright/test —— AGENTS.md 禁止引入测试框架，这里只用 playwright 库。
//
// 只测**必须用浏览器才能验的**：DOM 可见性、路由跳转、按钮三态、抽屉 Tab、
// 表单错误态与改密后的登录跳转。所有"状态码 / 业务码 / 分页正确性"都在
// verify-p55.sh 的 L2 里用 curl 断言——放进浏览器只会让它们变慢变脆。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const EMAIL_A = process.env.E2E_EMAIL_A
const EMAIL_B = process.env.E2E_EMAIL_B
const PASS_A = process.env.E2E_PASSWORD_A
const PASS_B = process.env.E2E_PASSWORD_B
const NEW_PASS_A = process.env.E2E_NEW_PASSWORD_A
const NICK_A = process.env.E2E_NICK_A
const NICK_B = process.env.E2E_NICK_B
const USER_ID_A = process.env.E2E_USER_ID_A
const USER_ID_B = process.env.E2E_USER_ID_B
const COMMUNITY = process.env.E2E_COMMUNITY
const POST_ID = process.env.E2E_POST_ID
const POST_TITLE = process.env.E2E_POST_TITLE
const DELETED_TITLE = process.env.E2E_DELETED_TITLE

const required = {
  E2E_EMAIL_A: EMAIL_A,
  E2E_EMAIL_B: EMAIL_B,
  E2E_PASSWORD_A: PASS_A,
  E2E_PASSWORD_B: PASS_B,
  E2E_NEW_PASSWORD_A: NEW_PASS_A,
  E2E_NICK_A: NICK_A,
  E2E_NICK_B: NICK_B,
  E2E_USER_ID_A: USER_ID_A,
  E2E_USER_ID_B: USER_ID_B,
  E2E_COMMUNITY: COMMUNITY,
  E2E_POST_ID: POST_ID,
  E2E_POST_TITLE: POST_TITLE,
  E2E_DELETED_TITLE: DELETED_TITLE,
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

/**
 * 依次尝试：内置 chromium → 系统 msedge → 系统 chrome。
 * 内置浏览器没下载成功时不该让整套验收卡死，系统浏览器足够验证这些行为。
 */
async function launchBrowser() {
  const attempts = [
    { label: 'bundled chromium', options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } },
  ]
  const errors = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(attempt.options)
      console.log(`  (浏览器：${attempt.label})`)
      return browser
    } catch (e) {
      errors.push(`${attempt.label}: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error(`无法启动浏览器：\n  ${errors.join('\n  ')}`)
}

/**
 * 收集页面级报错，只用于**游客**那一组。
 *
 * 只看三类：未捕获异常、4xx/5xx 响应。
 * 两个刻意排除项：
 *   - /api/user/auth/refresh：游客首屏的静默续期探测，401 是设计好的行为
 *   - /api/notification/stream：登录态页面的 SSE 长连接，导航时会主动断开
 * 其余 4xx/5xx 一律记下 URL——只报"有报错"没法定位。
 */
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
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await page.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 20000 })
}

/**
 * 等抽屉滑进来。
 *
 * 抽屉收起时是 `translate-x-full`，元素**仍在 DOM 里且有 boundingBox**，
 * `isVisible()` 会误判为可见。而刚点开时动画还没跑完（250ms），
 * 立刻量也会量到 x=视口宽度。所以位置要轮询到稳定为止。
 */
async function openDrawer(page) {
  const drawer = page.getByTestId('message-drawer')
  await drawer.waitFor({ state: 'attached', timeout: 10000 })
  for (let i = 0; i < 20; i += 1) {
    const box = await drawer.boundingBox()
    const viewport = page.viewportSize()
    if (box && viewport && box.x + box.width <= viewport.width + 2) return drawer
    await page.waitForTimeout(100)
  }
  return null
}

/**
 * 关注消息是异步落库的（outbox → MQ → 消费者）。
 * 固定 sleep 在慢的时候会假红，所以轮询：先看当前列表，
 * 没有就整页重载再开抽屉（重载一定重新拉消息列表）。
 */
async function waitForFollowMessage(page) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await page.getByTestId('nav-messages').click()
    const drawer = await openDrawer(page)
    if (!drawer) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByTestId('nav-messages').waitFor({ state: 'visible', timeout: 20000 })
      continue
    }
    // Tab 的可见文字是「关注」+ 未读数，所以不能用 exact 名称匹配：
    // 有未读时无障碍名会是「关注 1」，exact 直接找不到元素。
    await drawer.getByRole('tab').filter({ hasText: '关注' }).click()
    const item = page.getByTestId('message-item').first()
    try {
      await item.waitFor({ state: 'visible', timeout: 4000 })
      const text = (await item.textContent()) ?? ''
      if (text.includes('关注了你')) return item
    } catch {
      // 还没到，重载后再试
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('nav-messages').waitFor({ state: 'visible', timeout: 20000 })
  }
  return null
}

const browser = await launchBrowser()

let guestContext
let ctxA
let ctxB
let pageA

try {
  // ================================================================ 游客
  guestContext = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const guest = await guestContext.newPage()
  const guestErrors = []
  watchErrors(guest, guestErrors)

  await guest.goto(`/u/${USER_ID_B}`, { waitUntil: 'domcontentloaded' })
  await guest.getByTestId('user-profile-page').waitFor({ timeout: 20000 })
  ok('游客可以打开 /u/:userId（用户主页对游客公开）')

  const nick = (await guest.getByTestId('user-profile-nickname').textContent()) ?? ''
  if (nick.trim() === NICK_B) ok('游客看到的是目标用户的昵称', nick.trim())
  else ng('主页昵称不对', `实得 ${nick.trim()} 期望 ${NICK_B}`)

  let tabsAll = true
  for (const key of ['posts', 'communities', 'following', 'followers']) {
    if ((await guest.getByTestId(`user-tab-${key}`).count()) === 0) tabsAll = false
  }
  if (tabsAll) ok('游客可见四个 Tab（帖子 / 社群 / 关注 / 粉丝）')
  else ng('四个 Tab 不全')

  await guest.getByTestId('user-tab-posts').click()
  await guest.getByTestId('user-posts').waitFor({ timeout: 15000 })
  const postsText = (await guest.getByTestId('user-posts').textContent()) ?? ''
  if (postsText.includes(POST_TITLE)) ok('游客「帖子」Tab 能看到 ta 发的帖子')
  else ng('「帖子」Tab 没有目标帖子', postsText.slice(0, 60))

  await guest.getByTestId('user-tab-communities').click()
  await guest.getByTestId('user-communities').waitFor({ timeout: 15000 })
  const communitiesText = (await guest.getByTestId('user-communities').textContent()) ?? ''
  if (communitiesText.includes(COMMUNITY)) ok('游客「社群」Tab 能看到 ta 加入的社群')
  else ng('「社群」Tab 没有目标社群', communitiesText.slice(0, 60))

  await guest.getByTestId('user-tab-following').click()
  await guest.getByTestId('user-follow-list').waitFor({ timeout: 15000 })
  const followingText = (await guest.getByTestId('user-follow-list').textContent()) ?? ''
  if (followingText.includes(NICK_A)) ok('游客「关注」Tab 能看到 ta 关注的人')
  else ng('「关注」Tab 没有目标用户', followingText.slice(0, 60))

  await guest.getByTestId('user-tab-followers').click()
  await guest.waitForFunction(
    () =>
      document.querySelector('[data-testid="user-follow-list"]') !== null ||
      document.querySelector('[data-testid="user-follow-list-empty"]') !== null,
    undefined,
    { timeout: 15000 },
  )
  ok('游客「粉丝」Tab 有正常渲染（列表或空态）')

  const errNodes = await guest.locator('[data-testid$="-error"]').count()
  if (errNodes === 0) ok('四个 Tab 都没有渲染错误态节点')
  else ng('主页上出现了错误态节点', `${String(errNodes)} 个`)

  if (guestErrors.length === 0) ok('游客浏览全程没有控制台报错')
  else ng('游客浏览有控制台报错', guestErrors.slice(0, 2).join(' | '))

  await guest.goto('/following', { waitUntil: 'domcontentloaded' })
  await guest.getByTestId('following-login-hint').waitFor({ timeout: 20000 })
  if ((await guest.getByTestId('following-error').count()) === 0) {
    ok('游客访问 /following 显示引导登录态（没有 401 报错噪音）')
  } else {
    ng('游客访问 /following 出现了错误态')
  }
  await guestContext.close()
  guestContext = undefined

  // ================================================================ 账号 A：关注链路
  ctxA = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  pageA = await ctxA.newPage()
  await login(pageA, EMAIL_A, PASS_A)
  ok(`账号 A（${NICK_A}）登录成功`)

  const postPath = `/c/${encodeURIComponent(COMMUNITY)}/p/${POST_ID}`
  await pageA.goto(postPath, { waitUntil: 'domcontentloaded' })
  await pageA.getByTestId('post-page').waitFor({ timeout: 20000 })
  ok('帖子详情页可打开')

  await pageA.getByTestId('post-author-link').click()
  await pageA.waitForURL((u) => u.pathname === `/u/${USER_ID_B}`, { timeout: 20000 })
  ok('点帖子作者跳到 /u/:userId')

  await pageA.goto(postPath, { waitUntil: 'domcontentloaded' })
  await pageA.getByTestId('post-page').waitFor({ timeout: 20000 })
  const followBtn = pageA.getByTestId('btn-follow')
  await followBtn.waitFor({ state: 'visible', timeout: 15000 })
  const labelBefore = (await followBtn.textContent()) ?? ''
  await followBtn.click()
  try {
    await pageA.waitForFunction(
      () => document.querySelector('[data-testid="btn-follow"]')?.getAttribute('data-following') === 'true',
      undefined,
      { timeout: 15000 },
    )
    ok('帖子详情的关注按钮从「关注」变为「已关注」', `点击前：${labelBefore.trim()}`)
  } catch {
    ng('详情页关注按钮没有变成已关注', (await followBtn.textContent())?.trim())
  }

  await pageA.goto('/following', { waitUntil: 'domcontentloaded' })
  await pageA.getByTestId('following-left').waitFor({ timeout: 20000 })
  const leftText = (await pageA.getByTestId('following-left').textContent()) ?? ''
  if (leftText.includes(NICK_B)) ok('关注页左栏出现刚关注的账号 B')
  else ng('关注页左栏没有账号 B', leftText.slice(0, 80))

  await pageA.getByTestId('following-posts').waitFor({ timeout: 20000 })
  const allText = (await pageA.getByTestId('following-posts').textContent()) ?? ''
  if (allText.includes(POST_TITLE)) ok('「全部关注」时间线展示 B 的帖子')
  else ng('「全部关注」时间线没有 B 的帖子', allText.slice(0, 80))

  await pageA.getByTestId('following-user-item').first().click()
  await pageA.getByTestId('following-author-posts').waitFor({ timeout: 20000 })
  const oneText = (await pageA.getByTestId('following-author-posts').textContent()) ?? ''
  if (oneText.includes(POST_TITLE)) ok('单人筛选时间线展示 B 的帖子')
  else ng('单人筛选时间线没有 B 的帖子', oneText.slice(0, 80))

  // ================================================================ 账号 B：关注消息
  ctxB = await browser.newContext({ baseURL: SITE, viewport: { width: 1280, height: 900 } })
  const pageB = await ctxB.newPage()
  await login(pageB, EMAIL_B, PASS_B)
  ok(`账号 B（${NICK_B}）登录成功`)

  await pageB.getByTestId('nav-unread').waitFor({ state: 'visible', timeout: 20000 })
  ok('B 的未读徽标亮起（关注消息计入未读总数）')

  const followItem = await waitForFollowMessage(pageB)
  if (!followItem) {
    ng('消息抽屉的「关注」Tab 没有等到 FOLLOW 消息')
  } else {
    const msgText = (await followItem.textContent()) ?? ''
    if (msgText.includes(NICK_A) && msgText.includes('关注了你')) {
      ok('消息抽屉「关注」Tab 显示 A 关注了 B', msgText.replace(/\s+/g, ' ').slice(0, 50))
    } else {
      ng('关注消息内容不对', msgText.replace(/\s+/g, ' ').slice(0, 80))
    }
    await followItem.getByTestId('message-link').click()
    await pageB.waitForURL((u) => u.pathname === `/u/${USER_ID_A}`, { timeout: 20000 })
    ok('点关注消息跳到 /u/:actorId')
  }

  // ================================================================ 账号 A：/me
  await pageA.goto('/me', { waitUntil: 'domcontentloaded' })
  await pageA.getByTestId('profile').waitFor({ timeout: 20000 })
  const p1Missing = []
  for (const id of ['profile', 'profile-nickname', 'btn-edit-profile', 'btn-logout']) {
    if ((await pageA.getByTestId(id).count()) === 0) p1Missing.push(id)
  }
  if (p1Missing.length === 0) ok('P1 的 /me data-testid 全部保留（profile / nickname / 编辑 / 退出）')
  else ng('P1 的 /me data-testid 缺失', p1Missing.join(' '))

  try {
    await pageA.getByTestId('session-list').waitFor({ state: 'visible', timeout: 20000 })
    ok('P1 的登录设备列表（session-list）仍在首屏')
  } catch {
    ng('session-list 不可见')
  }

  const myProfileHref = await pageA.getByTestId('link-my-profile').getAttribute('href')
  if (myProfileHref === `/u/${USER_ID_A}`) ok('「查看我的主页」链接指向自己的主页')
  else ng('「查看我的主页」链接不对', String(myProfileHref))

  await pageA.getByTestId('my-favorites').waitFor({ timeout: 20000 })
  try {
    await pageA.getByTestId('favorite-post').first().waitFor({ state: 'visible', timeout: 20000 })
    const favText = (await pageA.getByTestId('favorite-post').first().textContent()) ?? ''
    if (favText.includes(POST_TITLE)) ok('我的收藏展示正常帖（带标题）')
    else ng('收藏里的正常帖标题不对', favText.slice(0, 60))
  } catch {
    ng('我的收藏没有正常帖')
  }

  try {
    await pageA.getByTestId('favorite-deleted-post').waitFor({ state: 'visible', timeout: 20000 })
    const delText = (await pageA.getByTestId('favorite-deleted-post').textContent()) ?? ''
    // 占位行不能带标题：batch 只返回未删除帖子，前端也不该把标题留在手里
    if (delText.includes('该帖子已被删除') && !delText.includes(DELETED_TITLE)) {
      ok('已删帖渲染成灰色占位（不泄露标题）')
    } else {
      ng('已删帖占位文案不对', delText.slice(0, 60))
    }
  } catch {
    ng('已删帖没有渲染占位行')
  }

  const deletedRow = pageA.locator('li:has([data-testid="favorite-deleted-post"])')
  if ((await deletedRow.count()) > 0) {
    await deletedRow.getByTestId('btn-unfavorite-item').click()
    try {
      await pageA.getByTestId('favorite-deleted-post').waitFor({ state: 'detached', timeout: 20000 })
      ok('点「取消收藏」后已删帖占位消失')
    } catch {
      ng('取消收藏后占位没有消失')
    }
  } else {
    ng('找不到已删帖占位所在的行，无法取消收藏')
  }

  // ================================================================ 账号 A：修改密码
  await pageA.getByTestId('btn-open-change-password').click()
  await pageA.getByTestId('field-old-password').fill('Wrong-Old-Passw0rd')
  await pageA.getByTestId('field-new-password').fill(NEW_PASS_A)
  await pageA.getByTestId('field-confirm-password').fill(NEW_PASS_A)
  await pageA.getByTestId('btn-submit-password').click()
  try {
    await pageA.getByTestId('password-error').waitFor({ state: 'visible', timeout: 20000 })
    const errText = (await pageA.getByTestId('password-error').textContent()) ?? ''
    const stillOnMe = new URL(pageA.url()).pathname === '/me'
    const stillLoggedIn = (await pageA.getByTestId('profile').count()) > 0
    if (stillOnMe && stillLoggedIn) ok('旧密码错误时提示错误且不掉线（HTTP 200 + 40207）', errText.trim())
    else ng('旧密码错误把用户踢下线了', pageA.url())
  } catch {
    ng('旧密码错误没有给出提示')
  }

  await pageA.getByTestId('field-old-password').fill(PASS_A)
  await pageA.getByTestId('field-new-password').fill(NEW_PASS_A)
  await pageA.getByTestId('field-confirm-password').fill(NEW_PASS_A)
  await pageA.getByTestId('btn-submit-password').click()
  try {
    await pageA.waitForURL((u) => u.pathname === '/login', { timeout: 20000 })
    await pageA.getByTestId('login-notice').waitFor({ state: 'visible', timeout: 15000 })
    const notice = (await pageA.getByTestId('login-notice').textContent()) ?? ''
    ok('改密成功 → 跳 /login 且显示 login-notice', notice.trim().slice(0, 40))
  } catch {
    ng('改密成功后没有跳登录页或没有提示', pageA.url())
  }

  await pageA.getByTestId('field-email').fill(EMAIL_A)
  await pageA.getByTestId('field-password').fill(NEW_PASS_A)
  await pageA.getByTestId('btn-submit').click()
  try {
    await pageA.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
    await pageA.getByTestId('nav-user').waitFor({ state: 'visible', timeout: 20000 })
    ok('用新密码重新登录成功')
  } catch {
    ng('新密码登录失败', pageA.url())
  }
} catch (e) {
  ng('浏览器验收抛异常', String(e.stack ?? e).split('\n').slice(0, 3).join(' | '))
} finally {
  if (guestContext) await guestContext.close().catch(() => {})
  if (ctxA) await ctxA.close().catch(() => {})
  if (ctxB) await ctxB.close().catch(() => {})
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
if (failed > 0) {
  console.error(`\n  ${String(failed)} 项失败`)
  process.exit(1)
}
console.log(`\n  ${String(results.length)} 项全部通过`)
