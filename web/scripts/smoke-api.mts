/**
 * 冒烟脚本：用**生成的类型**直接打真实后端。
 *
 *   npm run smoke:api
 *
 * 这个脚本的作用不是"测试"，而是让编译器充当测试：
 * 如果后端的响应结构与已提交的类型不一致，`npm run typecheck` 会先红；
 * 如果后端改了接口而类型没重新生成，P0.5 的 L2 断言（gen:types 后 git diff 为空）会红。
 *
 * 它跑在 Node 里、不经过浏览器，因此也顺带验证了 client.ts 的解包逻辑
 * 在没有 window 的环境下同样可用。
 */
import { api } from '../src/shared/api/client.ts'
import type { operations } from '../src/shared/api/types/user-service.gen.ts'

/** 后端所有 /ping 接口的返回信封相同，直接复用 user-service 的 spec 类型 */
type PingEnvelope = operations['userPing']['responses'][200]['content']['*/*']
type PingData = NonNullable<PingEnvelope['data']>

const SERVICES = ['user', 'community', 'content', 'interaction', 'notification', 'search', 'rank']

let failed = 0

for (const name of SERVICES) {
  const path = `/api/${name}/ping`
  try {
    const data = await api.get<PingData>(path)
    const service = data['service']
    const port = data['port']
    if (typeof service !== 'string' || service.length === 0) {
      throw new Error('响应里没有 service 字段')
    }
    console.log(`  ✓ ${path.padEnd(26)} service=${service} port=${String(port)}`)
  } catch (err) {
    failed += 1
    console.log(`  ✗ ${path.padEnd(26)} ${err instanceof Error ? err.message : String(err)}`)
  }
}

// 未知路由必须 404，且 client 要把它转成 ApiError 而不是抛裸异常
try {
  await api.get<unknown>('/api/nope/ping')
  failed += 1
  console.log('  ✗ /api/nope/ping 竟然成功了')
} catch (err) {
  const status = (err as { status?: number }).status
  const code = (err as { code?: unknown }).code
  if (status === 404) {
    console.log(`  ✓ /api/nope/ping 返回 404，已转成 ApiError(code=${String(code)})`)
  } else {
    failed += 1
    console.log(`  ✗ /api/nope/ping 期望 404，实际 status=${String(status)}`)
  }
}

console.log()
if (failed > 0) {
  console.error(`冒烟失败：${String(failed)} 项`)
  process.exit(1)
}
console.log('冒烟通过')
