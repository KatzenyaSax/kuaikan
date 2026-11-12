#!/usr/bin/env node
// deploy/bin 下 shell 脚本的静态检查。任何一条不过都非零退出。
//
//   node deploy/bin/check-scripts.mjs
//
// 目前只查一条规则，但它是反复踩过的：
//
//   **`$VAR` 后面紧跟非 ASCII 字符时，必须写成 `${VAR}`。**
//
// 原因：macOS 自带的是 bash 3.2，不是 UTF-8 aware。它按字节解析变量名，
// 于是 `"HTTP $a，说明..."` 里的全角逗号会被当成变量名的一部分，
// 报 `a，: unbound variable`。Linux 上的 bash 4+ 不会有这个问题，
// 所以这类错误**只在本地跑脚本时才炸**，而本地正是开发时最常跑的地方。
//
// 这个坑已经踩了三次（verify-p1 的 USER_ID2、verify.sh 的 expect_id、
// verify-p2 的 $a），所以把它变成一条会红的检查，而不是靠记忆。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const binDir = join(repoRoot, 'deploy', 'bin')

const files = readdirSync(binDir)
  .filter((f) => f.endsWith('.sh'))
  .sort()

const problems = []

for (const file of files) {
  const path = join(binDir, file)
  const lines = readFileSync(path, 'utf8').split('\n')

  lines.forEach((line, idx) => {
    // 去掉行尾注释与字符串里的转义复杂度不值得，直接逐字节扫描：
    // 找出所有 $NAME 且紧跟一个 >=0x80 字节的位置
    const re = /\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7f])/g
    let m
    while ((m = re.exec(line)) !== null) {
      problems.push(
        `${file}:${idx + 1}  $${m[1]} 后面紧跟非 ASCII 字符，` +
          `bash 3.2 会把它吞进变量名 → 改成 \${${m[1]}}\n      ${line.trim().slice(0, 100)}`,
      )
    }
  })

  const src = lines.join('\n')
  if (!src.includes('set -') || !/set -[a-z]*u/.test(src)) {
    problems.push(`${file}  缺少 set -u（未定义变量会静默变成空字符串）`)
  }
  if (!src.startsWith('#!/usr/bin/env bash')) {
    problems.push(`${file}  shebang 必须是 #!/usr/bin/env bash`)
  }
}

if (problems.length > 0) {
  console.error('脚本检查未通过：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log(`脚本检查通过（${String(files.length)} 个）：`)
console.log('  ✓ $VAR 后紧跟非 ASCII 处均已写成 ${VAR}（bash 3.2 兼容）')
console.log('  ✓ 全部 set -u')
console.log('  ✓ shebang 统一')
