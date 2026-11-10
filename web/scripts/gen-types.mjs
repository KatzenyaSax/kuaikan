// 从 web/openapi/*.json 生成按服务拆分的 TypeScript 类型。
//
//   npm run gen:types
//
// 为什么按服务拆成多份而不是合并成一个大 bundle：
//   ADR 0005 已经明确「前端需要知道各服务的路径前缀，服务边界对前端可见」。
//   多份类型文件与这个边界一一对应；合并反而会掩盖边界。
//
// 生成物入库，且禁止手改 —— 目的是让「后端改了接口但前端类型没重新生成」
// 能被 `git diff` 变成一条可执行的断言（P0.5 的 L2）。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const specDir = join(webRoot, 'openapi')
const outDir = join(webRoot, 'src', 'shared', 'api', 'types')

const BANNER = `/* eslint-disable */
/**
 * 本文件由 \`npm run gen:types\` 生成，禁止手改。
 * 源：web/openapi/%SPEC%
 * 改了后端接口请重新运行 \`./deploy/bin/openapi-dump.sh && npm run gen:types\`。
 */
`

if (!existsSync(specDir)) {
  console.error(`缺少 ${specDir}，先运行 ./deploy/bin/openapi-dump.sh`)
  process.exit(1)
}

const specs = readdirSync(specDir).filter((f) => f.endsWith('.json')).sort()
if (specs.length === 0) {
  console.error(`${specDir} 下没有 spec`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

let failed = 0
for (const file of specs) {
  const service = file.replace(/\.json$/, '')
  const input = join(specDir, file)
  const output = join(outDir, `${service}.gen.ts`)

  const result = spawnSync(
    process.execPath,
    [join(webRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js'), input, '-o', output],
    { stdio: 'inherit' },
  )

  if (result.status !== 0) {
    console.error(`  ✗ ${service} 生成失败`)
    failed += 1
    continue
  }

  const generated = readFileSync(output, 'utf8')
  writeFileSync(output, BANNER.replace('%SPEC%', file) + generated)
  console.log(`  ✓ ${service}  ->  src/shared/api/types/${service}.gen.ts`)
}

if (failed > 0) {
  console.error(`${failed} 个服务生成失败`)
  process.exit(1)
}
console.log(`\n共生成 ${specs.length} 份类型`)
