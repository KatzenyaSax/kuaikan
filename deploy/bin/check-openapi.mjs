#!/usr/bin/env node
// OpenAPI 与网关游客放行规则的一致性校验。
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
//   2. spec 里声明「游客可访问」（security: []）的端点，必须被网关放行规则覆盖
//      → 漏配 = 游客拿到 401。这个错误在浏览器验收里才暴露，代价是一整轮返工。
//
//   3. 网关放行规则里的精确条目，必须能在某个 spec 里找到
//      → 防止规则腐化：端点改名/删除了，规则还留着。
//
// 放行规则是 **(方法, 路径) 二元组**，不是单独的路径。同一路径常常读公开、
// 写需要登录（`/communities` 的 GET 与 POST、P2.3 的 `/posts` 同理）。
// 只按路径判断会把写端点一起放行，症状是"带着 token 反而说没登录"。
//
// 通配规则（方法位为 `*`）不做存在性校验，但会单独列出来提醒——
// `/ping/**` 是 P1 的已知债务，藏起来比列出来更糟。
//
// 为什么不引 YAML 解析库：deploy/bin 下的脚本只依赖 node 内置模块（与
// check-contract.mjs 一致）。网关配置里需要读的两块结构都很浅，逐行匹配足够。
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

/** 解析 `<METHOD> <路径或正则>`。格式错误在这里就报，不必等网关启动失败 */
function parseRule(raw, kind) {
  const space = raw.indexOf(' ')
  if (space <= 0) {
    note(`${kind} 条目「${raw}」缺少方法前缀，应为「<METHOD> ${raw}」或「* ${raw}」`)
    return null
  }
  const method = raw.slice(0, space).trim().toUpperCase()
  const rest = raw.slice(space + 1).trim()
  if (!rest) {
    note(`${kind} 条目「${raw}」缺少路径`)
    return null
  }
  return { method, rest, kind, raw, regex: kind === 'public-patterns' }
}

const routes = readRoutes(yml)
const whitelistRules = readYamlList(yml, 'whitelist')
  .map((r) => parseRule(r, 'whitelist'))
  .filter(Boolean)
const patternRules = readYamlList(yml, 'public-patterns')
  .map((r) => parseRule(r, 'public-patterns'))
  .filter(Boolean)

if (routes.length === 0) {
  console.error(`✗ 没能从 ${gatewayYml} 解析出任何路由，脚本本身可能失效了`)
  process.exit(1)
}

const prefixOfService = new Map(routes.map((r) => [r.service, r.prefix]))
const serviceOfPrefix = new Map(routes.map((r) => [r.prefix, r.service]))

/**
 * spec 里的路径是**模板**（`/posts/{postId}`），而网关放行规则的正则作用在
 * **真实请求路径**（`/posts/2120789385803038721`）上。所以不能拿模板字符串
 * 直接去匹配正则 —— 那样 `[0-9]+` 这种"只认数字 id"的精确规则会永远判为不覆盖，
 * 而它恰恰是我们刻意写得最严的那种。
 *
 * 这里把模板参数替换成几个代表性取值再匹配：数字、字母、带连字符。
 * 只要有一个能匹配就算覆盖。这是启发式，不是判定 —— 它要拦的是
 * "忘了加放行条目 / 方法写错了" 这类粗错，不是证明正则等价。
 */
function concretePaths(template) {
  const fillers = ['2120789385803038721', 'abc', 'foo-bar']
  return fillers.map((f) => template.replace(/\{[^/}]+\}/g, f))
}

function ruleCovers(rule, method, path) {
  if (rule.method !== '*' && rule.method !== method) return false
  if (!rule.regex) return rule.rest === path
  const re = new RegExp(rule.rest)
  return concretePaths(path).some((p) => re.test(p))
}

// ---------------------------------------------------------------- 读 spec

const specFiles = readdirSync(specDir).filter((f) => f.endsWith('.json')).sort()
if (specFiles.length === 0) {
  console.error(`✗ ${specDir} 下没有 spec，先运行 ./deploy/bin/openapi-dump.sh`)
  process.exit(1)
}

/** service 名 → Map(路径 → Set(方法)) */
const endpointsByService = new Map()
/** operationId → [{ service, method, path }] */
const opIdOwners = new Map()

let endpointCount = 0
let publicEndpointCount = 0

for (const file of specFiles) {
  const service = file.replace(/\.json$/, '')
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const endpoints = new Map()

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [rawMethod, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object') continue
      const method = rawMethod.toUpperCase()
      endpointCount += 1

      if (!endpoints.has(path)) endpoints.set(path, new Set())
      endpoints.get(path).add(method)

      const opId = op.operationId
      if (opId) {
        const list = opIdOwners.get(opId) ?? []
        list.push({ service, method, path })
        opIdOwners.set(opId, list)
      }

      // 声明为「游客可访问」
      if (Array.isArray(op.security) && op.security.length === 0) {
        if (path.startsWith('/internal')) continue // 网关根本不路由，不参与比对
        const prefix = prefixOfService.get(service)
        if (!prefix) {
          note(`${service} 的 ${method} ${path} 声明为公开，但网关没有该服务的路由`)
          continue
        }
        publicEndpointCount += 1
        const external = `/api/${prefix}${path}`
        const covered = [...whitelistRules, ...patternRules].some((r) =>
          ruleCovers(r, method, external),
        )
        if (!covered) {
          note(`${method} ${external} 声明为公开（security: []），但网关放行规则没有它 → 游客会拿到 401`)
        }
      }
    }
  }

  endpointsByService.set(service, endpoints)
}

// ---------------------------------------------------------------- 检查 1：operationId 唯一

for (const [opId, owners] of opIdOwners) {
  if (owners.length <= 1) continue
  note(
    `operationId「${opId}」重复：${owners.map((o) => `${o.service} ${o.method} ${o.path}`).join(' / ')}` +
      ' → 前端 typed.ts 合并后会静默指向其中一个',
  )
}

// ---------------------------------------------------------------- 检查 3：精确放行条目必须存在

for (const rule of whitelistRules) {
  const m = rule.rest.match(/^\/api\/([^/]+)(\/.*)$/)
  if (!m) {
    note(`放行条目「${rule.raw}」不是 /api/{服务前缀}/... 的形式，无法校验`)
    continue
  }
  const [, prefix, inner] = m
  const service = serviceOfPrefix.get(prefix)
  if (!service) {
    note(`放行条目「${rule.raw}」的前缀 ${prefix} 在网关路由里不存在`)
    continue
  }
  const endpoints = endpointsByService.get(service)
  if (!endpoints) {
    note(`放行条目「${rule.raw}」指向的服务 ${service} 没有 spec 文件`)
    continue
  }
  const methods = endpoints.get(inner)
  if (!methods) {
    note(`放行条目「${rule.raw}」在 ${service} 的 spec 里找不到 ${inner} → 规则已腐化`)
    continue
  }
  if (rule.method !== '*' && !methods.has(rule.method)) {
    note(
      `放行条目「${rule.raw}」在 ${service} 的 spec 里没有 ${rule.method} 方法` +
        `（该路径只有 ${[...methods].join('/')}）→ 规则与实现不符`,
    )
  }
}

// ---------------------------------------------------------------- 输出

if (problems.length > 0) {
  console.error('契约不一致：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log('OpenAPI 与网关放行规则一致')
console.log(`  ✓ operationId 唯一（${String(opIdOwners.size)} 个，跨 ${String(specFiles.length)} 个服务）`)
console.log(`  ✓ 精确放行条目全部存在（${String(whitelistRules.length)} 条）`)
console.log(`  ✓ 公开端点全部被放行规则覆盖（${String(publicEndpointCount)} 个，含方法匹配）`)

const wildcardRules = [...whitelistRules, ...patternRules].filter((r) => r.method === '*')
if (wildcardRules.length > 0) {
  console.log(`  ⚠ 通配方法规则 ${String(wildcardRules.length)} 条（未做存在性校验，属 P1 已知债务）：`)
  for (const r of wildcardRules) console.log(`      ${r.raw}`)
}
console.log(`  共 ${String(endpointCount)} 个端点`)
