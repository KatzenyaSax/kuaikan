import { useState } from 'react'
import { ApiError } from '@/shared/api/api-error'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

type SentinelResult = OkData<'userSentinel'>

const BURST = 6
const GAP_MS = 60

/**
 * Sentinel 限流探针：阈值 QPS=2 写在 user-service 的 P0SentinelConfig 里。
 * 预期放行 2 次、其余 429 + code 42900。
 */
export function SentinelPanel() {
  const [lines, setLines] = useState<string[]>(['尚未测试'])
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    const out: string[] = [`连打 ${String(BURST)} 次 /api/user/ping/sentinel：`, '']
    setLines([...out])
    let blocked = 0
    for (let i = 1; i <= BURST; i += 1) {
      const t0 = performance.now()
      try {
        await api.get<SentinelResult>('/api/user/ping/sentinel')
        out.push(`  ${String(i)}   放行   ${String(Math.round(performance.now() - t0))} ms`)
      } catch (err) {
        const limited = err instanceof ApiError && err.isRateLimited
        if (limited) blocked += 1
        const label = limited ? '限流' : '错误'
        const detail = err instanceof Error ? err.message : String(err)
        out.push(
          `  ${String(i)}   ${label}   ${String(Math.round(performance.now() - t0))} ms   ${detail}`,
        )
      }
      setLines([...out])
      await new Promise((r) => setTimeout(r, GAP_MS))
    }
    out.push('', `→ 放行 ${String(BURST - blocked)} 次，限流 ${String(blocked)} 次（阈值 QPS=2/秒）`)
    setLines([...out])
    setBusy(false)
  }

  return (
    <Card className="space-y-3">
      <CardTitle>Sentinel 限流</CardTitle>
      <CardDescription>
        阈值 QPS=2。被限流时返回 HTTP 429 + 统一响应体 code 42900，而不是裸 500。
      </CardDescription>
      <div>
        <Button variant="outline" size="sm" onClick={run} disabled={busy} data-testid="btn-sentinel">
          {busy ? '压测中…' : `连打 ${String(BURST)} 次`}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto rounded border border-border bg-muted p-3 text-[11px] leading-relaxed">
        {lines.join('\n')}
      </pre>
    </Card>
  )
}
