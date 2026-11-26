#!/usr/bin/env node
// P9.0 检索质量评测与相关帖子阈值校准脚本（非单元测试）。
// 对比纯 BM25、纯向量（VECTOR）、应用层 RRF（HYBRID）在 20 条跨词/自然语言问法上的 Recall@5 与 MRR@5，
// 并抽样线上真实帖子之间的 cosine 相似度分布以校准 related-min-score。
import { execFileSync } from 'node:child_process'

const SSH_HOST = process.env.SSH_HOST ?? 'root@206.237.30.147'

const EVAL_CASES = [
  { query: '给父元素加样式不用 JS 怎么实现', expected: ['2121868183205761025'] },
  { query: '页面加载卡顿怎么定位性能优化', expected: ['2121868187743997954'] },
  { query: '多个前端子应用合并拆回单体', expected: ['2121868190721953794'] },
  { query: 'Rust 异步状态机自引用为什么移动会出问题', expected: ['2121868198359781377'] },
  { query: '怎么把牛排煎得外焦里嫩不翻车', expected: ['2121868208392556546'] },
  { query: '下班独居懒得做饭怎么吃得健康', expected: ['2121868212515557377'] },
  { query: '升级 TS 别名路径配置报错怎么改', expected: ['2121868214155530241'] },
  { query: '接口返回值在运行阶段怎么和静态类型保持一致', expected: ['2121868233407385601', '2124782811748315138'] },
  { query: '苹果手机浏览器底部按钮被遮挡怎么修', expected: ['2124782723613405186'] },
  { query: '切 Tab 感觉卡顿怎么提升流畅度', expected: ['2124782767783620610'] },
  { query: '理发店被推销办卡烫头怎么拒绝', expected: ['2124782272012693506'] },
  { query: '签租房合同前实地看房要注意什么坑', expected: ['2124782309576880130'] },
  { query: '通勤坐地铁旁边人手机外放太吵', expected: ['2124782335283769345'] },
  { query: '二手交易平台遇到胡乱压价的怎么回', expected: ['2124782367189839874'] },
  { query: '上班想省钱自己弄冰咖啡怎么冲', expected: ['2124782458285928450'] },
  { query: '下午困得不行喝美式没用还有什么提神饮料', expected: ['2124782554826223617'] },
  { query: '做一顿下饭的家常菜有什么推荐', expected: ['2124782603471761409', '2122206300655030273', '2124782584626753537'] },
  { query: '出门旅游到底还要不要带沉重的单反微单', expected: ['2124782706165100545'] },
  { query: '用编译型系统语言重写 Python 脚本提速', expected: ['2124782828320010242'] },
  { query: '写命令行小软件错误类型有必要全部自己定义枚举吗', expected: ['2124782873505247233'] },
]

const RELATED_SAMPLE_POSTS = [
  { postId: '2121868195117584385', label: '借用检查器其实在帮你做设计' },
  { postId: '2121868208392556546', label: '煎牛排：我失败了十七次之后总结的四条' },
  { postId: '2121868201128022018', label: '35mm 定焦拍人像，注意这五件事' },
  { postId: '2124782436433604610', label: '瑞幸9块9喝了一年，今天咬牙买了杯38的社区店手冲' },
  { postId: '2121868233407385601', label: 'zod 之后再也没手写过校验' },
  { postId: '2120844040454787074', label: 'test (低信息短帖)' },
]

function remoteCurlJson(method, path, bodyObj) {
  const b64 = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8').toString('base64') : ''
  const cmd = bodyObj
    ? `docker exec kuaikan-search-service-1 sh -c 'echo ${b64} | base64 -d | curl -fsS -X ${method} -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:8086${path}"'`
    : `docker exec kuaikan-search-service-1 curl -fsS -X ${method} "http://127.0.0.1:8086${path}"`
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_HOST, cmd], {
    encoding: 'utf8',
  })
  return JSON.parse(out).data
}

function evalMode(mode) {
  let hitCount = 0
  let mrrSum = 0
  const misses = []
  for (const tc of EVAL_CASES) {
    const hits = remoteCurlJson('POST', '/internal/admin/eval-search', {
      query: tc.query,
      mode,
      limit: 5,
    })
    const ids = hits.map((h) => h.postId)
    const rank = ids.findIndex((id) => tc.expected.includes(id))
    if (rank >= 0) {
      hitCount += 1
      mrrSum += 1 / (rank + 1)
    } else {
      misses.push({ query: tc.query, top3: hits.slice(0, 3).map((h) => h.title) })
    }
  }
  const n = EVAL_CASES.length
  return {
    mode,
    recall5: (hitCount / n) * 100,
    hits: hitCount,
    total: n,
    mrr5: mrrSum / n,
    misses,
  }
}

console.log('=== P9.0 检索质量对比（20 条跨词/自然语言问法，56 篇线上样本）===')
for (const mode of ['BM25', 'VECTOR', 'HYBRID']) {
  const r = evalMode(mode)
  console.log(
    `${r.mode.padEnd(6)} | Recall@5 = ${r.hits}/${r.total} (${r.recall5.toFixed(1)}%) | MRR@5 = ${r.mrr5.toFixed(3)}`,
  )
  if (r.misses.length > 0) {
    for (const m of r.misses) {
      console.log(`   miss: "${m.query}" -> [${m.top3.join(' / ')}]`)
    }
  }
}

console.log('\n=== 相关帖子 cosine 得分抽样（ES cosine = (1+cos)/2）===')
for (const sample of RELATED_SAMPLE_POSTS) {
  const related = remoteCurlJson('GET', `/internal/admin/eval-related/${sample.postId}?limit=5&minScore=0.0`)
  console.log(`\n[${sample.label}] (${sample.postId})`)
  for (const r of related) {
    console.log(`  ${r.score.toFixed(4)} | ${r.communityName} | ${r.title}`)
  }
}
