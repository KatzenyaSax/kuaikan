#!/usr/bin/env node
// OpenAPI 与网关白名单的一致性校验。
//
//   node deploy/bin/check-openapi.mjs
//
// 三条检查，任何一条不过都非零退出：
//
//   1. operationId 在所有服务之间唯一
//      → 前端 typed.ts 用交叉类型合并各服务的 operations。同名 operationId 会被
//        合并成 A & B；两个形状兼容时 TypeScript 照常编译通过，类型却悄悄指到了
//        另一个服务。这是最难发现的一类 bug，只能在契约层拦。
//
//   2. spec 里声明「游客可访问」（security: []）的端点，必须被网关白名单覆盖
//      → 漏配白名单 = 游客拿到 401。这个错误在浏览器验收里才暴露，代价是一整轮返工。
//
//   3. 网关白名单里的精确条目，必须能在某个 spec 里找到
//      → 防止白名单腐化：端点改名/删除了，白名单还留着。
//
// 通配白名单（如 /api/[^/]+/ping/**）不做第 3 条检查，但会单独列出来提醒——
// 那是 P1 的已知债务，藏起来比列出来更糟。
//
// 为什么不引 YAML 解析库：deploy/bin 下的脚本只依赖 node 内置模块（与
// check-contract.mjs 一致）。网关配置里需要读的两块结构都很浅，逐行匹配足够；
// 一旦白名单迁到 Nacos 变得复杂，再引库不迟。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const specDir = join(repoRoot, 'web', 'openapi')
const gatewayYml = join(repoRoot, 'services', 'gateway', 'src', 'main', 'resources', 'application.yml')

const problems = []
const note = (msg) => problems.push(msg)

// ---------------------------------------------------------------- 读网关配置

const yml = readFileSync(gatewayYml, 'utf8')

/** 从缩进块里读一个字符串列表（`key:` 下面若干 `- xxx`） */
function readYamlList(text, key) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l))
  if (start < 0) return []
  const indent = lines[start].match(/^\s*/)[0].length
  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const ind = line.match(/^\s*/)[0].length
    if (ind <= indent) break
    const m = line.match(/^\s*-\s*(.+?)\s*$/)
    if (!m) break
    out.push(m[1].replace(/^['"]|['"]$/g, ''))
  }
  return out
}

/** 路径前缀 → 服务名，来自 gateway routes 段 */
function readRoutes(text) {
  const routes = []
  let pending = null
  for (const line of text.split('\n')) {
    const idMatch = line.match(/^\s*-\s*id:\s*(\S+)\s*$/)
    if (idMatch) {
      pending = { service: idMatch[1] }
      continue
    }
    const uriMatch = line.match(/^\s*uri:\s*lb:\/\/(\S+)\s*$/)
    if (uriMatch && pending) {
      pending.service = uriMatch[1]
      continue
    }
    const pathMatch = line.match(/^\s*-\s*Path=\/api\/([^/]+)\/\*\*\s*$/)
    if (pathMatch && pending) {
      routes.push({ prefix: pathMatch[1], service: pending.service })
      pending = null
    }
  }
  return routes
}

const routes = readRoutes(yml)
const whitelist = readYamlList(yml, 'whitelist')
const publicPatterns = readYamlList(yml, 'public-patterns')

if (routes.length === 0) {
  console.error(`✗ 没能从 ${gatewayYml} 解析出任何路由，脚本本身可能失效了`)
  process.exit(1)
}

const prefixOfService = new Map(routes.map((r) => [r.service, r.prefix]))
const serviceOfPrefix = new Map(routes.map((r) => [r.prefix, r.service]))

// ---------------------------------------------------------------- 读 spec

const specFiles = readdirSync(specDir).filter((f) => f.endsWith('.json')).sort()
if (specFiles.length === 0) {
  console.error(`✗ ${specDir} 下没有 spec，先运行 ./deploy/bin/openapi-dump.sh`)
  process.exit(1)
}

/** service 名 → { 规范化路径 → [method] } */
const endpointsByService = new Map()
/** operationId → [{ service, method, path }] */
const opIdOwners = new Map()

let endpointCount = 0
let publicEndpointCount = 0

for (const file of specFiles) {
  const service = file.replace(/\.json$/, '')
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const paths = spec.paths ?? {}
  const endpoints = new Map()

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object') continue
      const upper = method.toUpperCase()
      endpointCount += 1

      endpoints.set(path, [...(endpoints.get(path) ?? []), upper])

      const opId = op.operationId
      if (opId) {
        const list = opIdOwners.get(opId) ?? []
        list.push({ service, method: upper, path })
        opIdOwners.set(opId, list)
      }

      // 声明为「游客可访问」
      const isPublic = Array.isArray(op.security) && op.security.length === 0
      if (isPublic) {
        if (path.startsWith('/internal')) continue // 网关根本不路由，不参与比对
        const prefix = prefixOfService.get(service)
        if (!prefix) {
          note(`${service} 的 ${upper} ${path} 声明为公开，但网关没有该服务的路由`)
          continue
        }
        publicEndpointCount += 1
        const external = `/api/${prefix}${path}`
        const covered =
          whitelist.includes(external) || publicPatterns.some((p) => new RegExp(p).test(external))
        if (!covered) {
          note(`${upper} ${external} 声明为公开（security: []），但网关白名单没有它 → 游客会拿到 401`)
        }
      }
    }
  }

  endpointsByService.set(service, endpoints)
}

// ---------------------------------------------------------------- 检查 1：operationId 唯一

const dupOps = [...opIdOwners.entries()].filter(([, owners]) => owners.length > 1)
for (const [opId, owners] of dupOps) {
  note(
    `operationId「${opId}」重复：${owners.map((o) => `${o.service} ${o.method} ${o.path}`).join(' / ')}` +
      ' → 前端 typed.ts 合并后会静默指向其中一个',
  )
}

// ---------------------------------------------------------------- 检查 3：白名单里的精确条目必须存在

for (const entry of whitelist) {
  const m = entry.match(/^\/api\/([^/]+)(\/.*)$/)
  if (!m) {
    note(`白名单条目「${entry}」不是 /api/{服务前缀}/... 的形式，无法校验`)
    continue
  }
  const [, prefix, inner] = m
  const service = serviceOfPrefix.get(prefix)
  if (!service) {
    note(`白名单条目「${entry}」的前缀 ${prefix} 在网关路由里不存在`)
    continue
  }
  const endpoints = endpointsByService.get(service)
  if (!endpoints) {
    note(`白名单条目「${entry}」指向的服务 ${service} 没有 spec 文件`)
    continue
  }
  if (!endpoints.has(inner)) {
    note(`白名单条目「${entry}」在 ${service} 的 spec 里找不到 ${inner} → 白名单已腐化`)
  }
}

// ---------------------------------------------------------------- 输出

if (problems.length > 0) {
  console.error('契约不一致：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log('OpenAPI 与网关白名单一致')
console.log(`  ✓ operationId 唯一（${String(opIdOwners.size)} 个，跨 ${String(specFiles.length)} 个服务）`)
console.log(`  ✓ 白名单精确条目全部存在（${String(whitelist.length)} 条）`)
console.log(`  ✓ 公开端点全部被白名单覆盖（${String(publicEndpointCount)} 个）`)
if (publicPatterns.length > 0) {
  console.log(`  ⚠ 通配白名单 ${String(publicPatterns.length)} 条（未做存在性校验，属 P1 已知债务）：`)
  for (const p of publicPatterns) console.log(`      ${p}`)
}
console.log(`  共 ${String(endpointCount)} 个端点`)
