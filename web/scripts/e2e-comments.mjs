// P3 评论区的浏览器验收：发评论、回复、展开、删除后的 tombstone 占位。
//
//   node web/scripts/e2e-comments.mjs
//
// 由 deploy/bin/verify-p3.sh 的 L3 调用。只测**必须用浏览器才能验的**：
// DOM 状态、展开交互、删除后占位是否还在。状态码与计数一致性都在 L2。
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD')
  process.exit(2)
}

const results = []
const ok = (m) => { results.push({ ok: true, msg: m }); console.log(`  ✓ ${m}`) }
const ng = (m, d) => { results.push({ ok: false, msg: m }); console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge' })
const ctx = await browser.newContext({ baseURL: SITE })
const page = await ctx.newPage()

try {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('field-email').fill(EMAIL)
  await page.getByTestId('field-password').fill(PASSWORD)
  await page.getByTestId('btn-submit').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })

  const community = `e2e-ui-c-${Date.now()}`
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByTestId('btn-new-community').click()
  await page.getByTestId('field-community-name').fill(community)
  await page.getByTestId('btn-create-community-submit').click()
  await page.waitForURL((u) => u.pathname.startsWith('/c/'), { timeout: 15000 })
  const base = new URL(page.url()).pathname

  await page.goto(`${base}/new`, { waitUntil: 'networkidle' })
  await page.getByTestId('field-post-title').fill('评论区验收')
  await page.getByTestId('field-post-body').fill('正文')
  await page.getByTestId('btn-submit-post').click()
  await page.getByTestId('comment-section').waitFor({ timeout: 15000 })
  ok('帖子详情页下出现评论区')

  // 评论区刚出现时列表可能还在 loading，要等空态真正渲染出来再断言。
  // 直接 count() 会因为竞态偶发失败。
  await page.getByTestId('comment-empty').waitFor({ timeout: 8000 }).catch(() => {})
  if ((await page.getByTestId('comment-empty').count()) > 0) ok('空态提示正常')
  else ng('空态提示缺失')

  // 发一级评论
  await page.getByTestId('field-comment-body').fill('这是一条评论')
  await page.getByTestId('btn-submit-comment').click()
  await page.getByTestId('comment-item').first().waitFor({ timeout: 15000 })
  const body1 = await page.getByTestId('comment-body').first().innerText()
  if (body1 === '这是一条评论') ok('发一级评论后立刻出现在列表里')
  else ng('一级评论没出现', body1)
  if ((await page.getByTestId('comment-count').innerText()) === '1') ok('评论数徽标显示 1')
  else ng('评论数徽标不对')

  // 回复
  await page.getByTestId('btn-reply').first().click()
  await page.getByTestId('field-reply-body').fill('这是一条回复')
  await page.getByTestId('btn-submit-reply').click()
  await page.getByTestId('reply-item').first().waitFor({ timeout: 15000 })
  const replyBody = await page.getByTestId('reply-body').first().innerText()
  if (replyBody === '这是一条回复') ok('回复后自动展开并显示')
  else ng('回复没出现', replyBody)
  const toText = await page.getByTestId('reply-to').first().innerText()
  if (toText.startsWith('回复 @')) ok(`回复显示「${toText}」（两级平铺靠它表达对话关系）`)
  else ng('缺少「回复 @某人」标记', toText)

  // 楼中楼里再回复：这是 P3.1 漏过的入口（原先只有一级评论能回复）
  await page.getByTestId('btn-reply-to-reply').first().click()
  await page.getByTestId('field-reply-body').fill('回复那条回复')
  await page.getByTestId('btn-submit-reply').click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="reply-item"]').length >= 2,
    null,
    { timeout: 15000 },
  )
  const replyBodies = await page.getByTestId('reply-body').allInnerTexts()
  if (replyBodies.includes('回复那条回复')) ok('楼中楼里可以再回复（平铺到同一层）')
  else ng('楼中楼里回复失败', replyBodies.join(' | '))

  // 展开状态下按钮文案是"收起回复"。先收起，再读"展开 N 条"里的 N，
  // 断言 N 等于实际的回复条数 —— 这就是"reply_count 是后代总数"的 UI 侧证明。
  const replyCount = await page.getByTestId('reply-item').count()
  await page.getByTestId('btn-expand-replies').first().click()
  await page.getByTestId('btn-expand-replies').first().waitFor({ timeout: 8000 })
  const expandText = await page.getByTestId('btn-expand-replies').first().innerText()
  if (expandText.includes(String(replyCount))) {
    ok(`「${expandText}」与实际回复条数一致（后代总数）`)
  } else {
    ng('展开条数与实际回复数不一致', `${expandText} vs ${replyCount}`)
  }
  // 刚才为了读"展开 N 条"把它收起了，后面还要验 tombstone 下的回复，重新展开
  await page.getByTestId('btn-expand-replies').first().click()
  await page.getByTestId('reply-item').first().waitFor({ timeout: 8000 })

  // 删除一级评论 → tombstone，回复仍在
  await page.getByTestId('btn-delete-comment').first().click()
  await page.getByTestId('comment-deleted').first().waitFor({ timeout: 15000 })
  const delText = await page.getByTestId('comment-deleted').first().innerText()
  if (delText === '该评论已删除') ok('删除后显示 tombstone 占位')
  else ng('tombstone 占位文案不对', delText)
  if ((await page.getByTestId('reply-body').count()) > 0) ok('tombstone 下的回复仍然可见')
  else ng('tombstone 吞掉了回复')
  // 删除一级评论后，可见评论 = 它的回复数（一级本身成了 tombstone，不计入）
  const visible = String(await page.getByTestId('reply-item').count())
  const shown = await page.getByTestId('comment-count').innerText()
  if (shown === visible) ok(`删除后评论数与可见回复数一致（${shown}）`)
  else ng('删除后评论数不对', `显示 ${shown}，可见回复 ${visible}`)

  // 游客视角：不能发评论
  const guest = await ctx.browser().newContext()
  const gp = await guest.newPage()
  await gp.goto(page.url(), { waitUntil: 'networkidle' })
  await gp.getByTestId('comment-section').waitFor({ timeout: 15000 })
  if ((await gp.getByTestId('comment-login-hint').count()) > 0) ok('游客看到「登录后可以发表评论」')
  else ng('游客看不到登录提示')
  if ((await gp.getByTestId('btn-submit-comment').count()) === 0) ok('游客看不到发表按钮')
  else ng('游客竟然能发评论')
  await guest.close()
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
