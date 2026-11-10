// 从 contract/error-codes.json 生成前端的错误码常量与文案表。
//
//   npm run gen:contract
//
// 生成物入库且禁止手改：目的是让「后端加了错误码但前端没跟上」
// 能被 P1 的 L0 契约断言发现，而不是等用户看到"操作失败"。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const src = join(repoRoot, 'contract', 'error-codes.json')
const out = join(here, '..', 'src', 'shared', 'api', 'error-codes.gen.ts')

const doc = JSON.parse(readFileSync(src, 'utf8'))
const codes = doc.codes

if (!Array.isArray(codes) || codes.length === 0) {
  console.error('contract/error-codes.json 里没有 codes')
  process.exit(1)
}

const seen = new Set()
for (const c of codes) {
  if (typeof c.code !== 'number' || typeof c.name !== 'string' || typeof c.message !== 'string') {
    console.error(`条目字段不完整：${JSON.stringify(c)}`)
    process.exit(1)
  }
  if (seen.has(c.code)) {
    console.error(`错误码重复：${String(c.code)}`)
    process.exit(1)
  }
  seen.add(c.code)
}

const rows = codes
  .slice()
  .sort((a, b) => a.code - b.code)
  .map((c) => `  ${String(c.code)}: '${c.message.replace(/'/g, "\\'")}', // ${c.name}`)
  .join('\n')

const content = `/* eslint-disable */
/**
 * 本文件由 \`npm run gen:contract\` 从 contract/error-codes.json 生成，禁止手改。
 * 后端改动错误码后请同步 contract/error-codes.json 并重新生成。
 */

/** 业务码 → 用户可读文案。缺项时由 resolveErrorMessage 兜底。 */
export const ERROR_MESSAGES: Readonly<Record<number, string>> = {
${rows}
} as const

/** 业务码 → HTTP 状态码。用于断言前后端对同一场景的状态码认知一致。 */
export const ERROR_HTTP_STATUS: Readonly<Record<number, number>> = {
${codes
  .slice()
  .sort((a, b) => a.code - b.code)
  .map((c) => `  ${String(c.code)}: ${String(c.http)},`)
  .join('\n')}
} as const

export function resolveErrorMessage(code: number | string, fallback: string): string {
  if (typeof code === 'number') {
    const hit = ERROR_MESSAGES[code]
    if (hit) return hit
  }
  return fallback
}
`

writeFileSync(out, content)
console.log(`  ✓ 生成 ${codes.length} 个错误码 -> src/shared/api/error-codes.gen.ts`)
