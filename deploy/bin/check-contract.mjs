#!/usr/bin/env node
// 契约一致性校验：contract/error-codes.json ↔ Java 枚举 ↔ 前端生成物。
//
//   node deploy/bin/check-contract.mjs
//
// P1 的 L0 层调用它。任何不一致都非零退出。
//
// 为什么用正则解析 Java 枚举而不是反射/编译：
//   这是个受控的小代码库，枚举写法固定为 NAME(<num>, "msg")。
//   为此引入 Java 运行时或 AST 解析器，成本远大于收益。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const contractPath = join(repoRoot, 'contract', 'error-codes.json')
const genTsPath = join(repoRoot, 'web', 'src', 'shared', 'api', 'error-codes.gen.ts')

const problems = []
const note = (msg) => problems.push(msg)

// ---------- 1. 读契约 ----------
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const expected = new Map()
for (const c of contract.codes) {
  expected.set(c.code, c)
}

// ---------- 2. 扫 Java 枚举 ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.java')) out.push(p)
  }
  return out
}

const javaFiles = walk(join(repoRoot, 'services')).filter((p) =>
  /ErrorCode\.java$|ErrorCode[A-Za-z]*\.java$/.test(p),
)

// 匹配 NAME(12345, "文案"),
const ENUM_ENTRY = /^\s*([A-Z][A-Z0-9_]*)\s*\(\s*(\d{5})\s*,\s*"([^"]*)"\s*\)/gm

const javaCodes = new Map()
for (const file of javaFiles) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('implements ErrorCode')) continue
  for (const m of src.matchAll(ENUM_ENTRY)) {
    const [, name, codeStr, message] = m
    const code = Number(codeStr)
    if (javaCodes.has(code)) {
      note(`Java 里错误码重复：${String(code)}（${javaCodes.get(code).name} 与 ${name}）`)
    }
    javaCodes.set(code, { name, message, file: file.replace(repoRoot + '/', '') })
  }
}

// ---------- 3. 比对 ----------
for (const [code, c] of expected) {
  const j = javaCodes.get(code)
  if (!j) {
    note(`契约里有但 Java 枚举里没有：${String(code)} ${c.name}`)
    continue
  }
  if (j.name !== c.name) {
    note(`名字不一致 ${String(code)}：契约 ${c.name} / Java ${j.name}`)
  }
  if (j.message !== c.message) {
    note(`文案不一致 ${String(code)}：\n      契约 "${c.message}"\n      Java "${j.message}"  (${j.file})`)
  }
}
for (const [code, j] of javaCodes) {
  if (!expected.has(code)) {
    note(`Java 里有但契约里没有：${String(code)} ${j.name}  (${j.file})`)
  }
}

// ---------- 4. 前端生成物是否覆盖全部码 ----------
let genTs = ''
try {
  genTs = readFileSync(genTsPath, 'utf8')
} catch {
  note(`缺少前端生成物：${genTsPath.replace(repoRoot + '/', '')}，先运行 npm run gen:contract`)
}
if (genTs) {
  for (const [code, c] of expected) {
    const re = new RegExp(`^\\s*${String(code)}:\\s*'`, 'm')
    if (!re.test(genTs)) {
      note(`前端生成物缺少错误码 ${String(code)} ${c.name}，请重新运行 npm run gen:contract`)
    }
  }
}

// ---------- 结果 ----------
if (problems.length > 0) {
  console.error('契约不一致：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error(`\n共 ${String(problems.length)} 处。唯一事实来源：contract/error-codes.json`)
  process.exit(1)
}

console.log(`契约一致：${String(expected.size)} 个错误码，Java 枚举 ${String(javaCodes.size)} 个，前端生成物已覆盖`)
