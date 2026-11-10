/**
 * P1.2 浏览器层验收。
 *
 *   E2E_EMAIL=xxx E2E_PASSWORD=yyy npm run e2e:auth
 *
 * 用 playwright 的**库形态**自己写断言，不引 @playwright/test：
 * AGENTS.md 禁止写单元测试/TDD 测试，引入 test runner 会让"测试"的边界变模糊。
 * 这里和 verify.sh / smoke-api.mts 是同一类东西——验收脚本，不产生 *.spec.ts。
 *
 * 这些断言只有浏览器能验：
 *   1. 未登录访问 /me 会被守卫重定向
 *   2. 登录后进入 /me
 *   3. 刷新页面不掉登录态（= httpOnly cookie + 启动静默续期真的成立）
 *   4. 刷新时不闪登录页（渲染时序）
 *   5. localStorage / sessionStorage 里没有 token
 *   6. refresh cookie 是 httpOnly + Secure + SameSite=Lax + Path 收窄
 *   7. 登出后 access 立刻失效，再访问 /me 又会被重定向
 */
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const EMAIL = process.env.E2E_EMAIL ?? ''
const PASSWORD = process.env.E2E_PASSWORD ?? ''
const REFRESH_COOKIE = 'kuaikan_refresh'

/**
 * 依次尝试：内置 chromium → 系统 msedge → 系统 chrome。
 * 内置浏览器没下载成功时不该让整个验收卡死，系统浏览器足够验证这些行为。
 */
async function launchBrowser() {
  const attempts = [{ label: 'bundled chromium', options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: 'Google Chrome', options: { channel: 'chrome' } }]
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

let pass = 0
let fail = 0
const failures = []

function ok(name, extra) {
  pass += 1
  console.log(`  ✓ ${name}${extra ? `  ${extra}` : ''}`)
}

function ng(name, detail) {
  fail += 1
  failures.push(name)
  console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('缺少 E2E_EMAIL / E2E_PASSWORD')
    process.exit(2)
  }

  const browser = await launchBrowser()
  const context = await browser.newContext({ baseURL: SITE })
  const page = await context.newPage()

  // ---- 1. 未登录访问 /me 应被重定向到登录页并带上 returnTo
  await page.goto('/me', { waitUntil: 'networkidle' })
  const url = new URL(page.url())
  if (url.pathname === '/login' && url.searchParams.get('returnTo') === '/me') {
    ok('未登录访问 /me → 跳转 /login?returnTo=/me')
  } else {
    ng('未登录守卫', `实际 ${page.url()}`)
  }

  // ---- 2. 登录
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('field-email').fill(EMAIL)
  await page.getByTestId('field-password').fill(PASSWORD)
  await page.getByTestId('btn-submit').click()

  try {
    await page.getByTestId('profile-nickname').waitFor({ timeout: 8000 })
    const nickname = await page.getByTestId('profile-nickname').innerText()
    ok('登录成功并进入 /me', `昵称=${nickname}`)
  } catch {
    const errorText = await page.getByTestId('toast-error').innerText().catch(() => '(无错误提示)')
    ng('登录后进入 /me', `错误提示：${errorText}`)
  }

  // ---- 3. cookie 属性
  const cookies = await context.cookies()
  const refresh = cookies.find((c) => c.name === REFRESH_COOKIE)
  if (!refresh) {
    ng('refresh cookie 存在')
  } else {
    const problems = []
    if (!refresh.httpOnly) problems.push('缺少 HttpOnly')
    if (!refresh.secure) problems.push('缺少 Secure')
    if ((refresh.sameSite ?? '').toLowerCase() !== 'lax') problems.push(`SameSite=${refresh.sameSite}`)
    if (refresh.path !== '/api/user/auth') problems.push(`Path=${refresh.path}`)
    if (problems.length === 0) {
      ok('refresh cookie 属性正确', 'HttpOnly / Secure / SameSite=Lax / Path=/api/user/auth')
    } else {
      ng('refresh cookie 属性', problems.join('，'))
    }
  }

  // ---- 4. 存储里没有 token
  const storage = await page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
    localValues: Object.values(window.localStorage).join('|'),
  }))
  const tokenLike = /accessToken|refresh|eyJ[A-Za-z0-9_-]{10,}/
  const keysDirty = [...storage.local, ...storage.session].some((k) => tokenLike.test(k))
  const valuesDirty = tokenLike.test(storage.localValues)
  if (!keysDirty && !valuesDirty) {
    ok('localStorage / sessionStorage 中没有 token')
  } else {
    ng('存储里出现 token', `keys=${storage.local.join(',')}`)
  }

  // ---- 5. 刷新页面：不闪登录页 + 仍处于登录态
  await page.addInitScript(() => {
    window.__saw = { loginForm: false, bootstrapping: false, observerReady: false }

    const check = () => {
      if (document.querySelector('[data-testid="login-form"]')) window.__saw.loginForm = true
      if (document.querySelector('[data-testid="auth-bootstrapping"]')) {
        window.__saw.bootstrapping = true
      }
    }

    // 只用 MutationObserver 观察 documentElement 是不可靠的：
    // addInitScript 执行时 documentElement 可能还不存在，observe(null) 会抛错，
    // 结果是"观察器从未装上、标志永远为 false"，断言就变成空转（永远绿）。
    // 所以观察 document（一定存在），再用 rAF 轮询兜底。
    try {
      const observer = new MutationObserver(check)
      observer.observe(document, { childList: true, subtree: true })
      window.__saw.observerReady = true
    } catch {
      window.__saw.observerReady = false
    }

    const tick = () => {
      check()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.reload({ waitUntil: 'networkidle' })

  const stillLoggedIn = await page
    .getByTestId('profile-nickname')
    .isVisible()
    .catch(() => false)
  if (stillLoggedIn) {
    ok('刷新页面后仍是登录态（静默续期生效）')
  } else {
    ng('刷新后掉登录态', `当前 URL ${page.url()}`)
  }

  const flags = await page.evaluate(() => window.__saw)
  if (!flags.observerReady) {
    ng('观察器未装上', '断言结果不可信')
  }
  if (!flags.loginForm) {
    ok('刷新过程中从未出现登录表单（不闪登录页）')
  } else {
    ng('刷新时闪了登录页', 'MutationObserver 捕获到 login-form 出现过')
  }
  if (flags.bootstrapping) {
    ok('刷新时出现过 bootstrap 加载态')
  } else {
    ng('没有观测到 bootstrap 加载态', '可能是检测方式失效，也可能是真的没有加载态')
  }

  // ---- 6. 登出
  await page.getByTestId('btn-logout').click()
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 8000 }).catch(() => {})

  await page.goto('/me', { waitUntil: 'networkidle' })
  const afterLogout = new URL(page.url())
  if (afterLogout.pathname === '/login') {
    ok('登出后访问 /me 再次被重定向到登录页')
  } else {
    ng('登出未生效', `实际 ${page.url()}`)
  }

  const cookiesAfter = await context.cookies()
  const refreshAfter = cookiesAfter.find((c) => c.name === REFRESH_COOKIE)
  if (!refreshAfter || refreshAfter.value === '') {
    ok('登出后 refresh cookie 已被清除')
  } else {
    ng('登出后 refresh cookie 仍存在')
  }

  await browser.close()

  console.log()
  if (fail > 0) {
    console.error(`失败 ${fail} 项：`)
    failures.forEach((f) => console.error(`  - ${f}`))
    process.exit(1)
  }
  console.log(`浏览器验收通过（${pass} 项）`)
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(2)
})
