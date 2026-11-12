import { useState } from 'react'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'
import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'

type SendResult = OkData<'userSendMq'>
type MqStatusResult = OkData<'userMqStatus'>

const POLL_INTERVAL_MS = 300
const MAX_POLLS = 40

/**
 * /ping/mq 的后端返回是 Result<Map<String,Object>>，反射到 OpenAPI 就是
 * `{[key: string]: unknown}`，所以 consumer.received 只能在运行时收口。
 * 这不是偷懒——生成类型如实反映了后端声明的类型，收口是调用方的责任。
 */
function isReceived(status: MqStatusResult): boolean {
  const consumer = status['consumer']
  if (typeof consumer !== 'object' || consumer === null) return false
  return (consumer as Record<string, unknown>)['received'] === true
}

/**
 * RocketMQ 端到端探针：user-service 发 → broker → community-service 收 → Feign 回查。
 * 从 P0 的静态冒烟台搬过来，现在跑在 React 里，类型来自 OpenAPI。
 */
export function MqPanel() {
  const [lines, setLines] = useState<string[]>(['尚未发送'])
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    const started = performance.now()
    setLines(['发送中…'])
    try {
      const sent = await api.post<SendResult>('/api/user/ping/mq')
      const log = [
        `POST /api/user/ping/mq`,
        `traceId    = ${sent.traceId}`,
        `sendStatus = ${sent.sendStatus}`,
        `msgId      = ${sent.msgId}`,
        '',
        '轮询消费结果（Feign 回查 community-service 台账）：',
      ]
      setLines([...log])

      for (let i = 1; i <= MAX_POLLS; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const status = await api.get<MqStatusResult>(`/api/user/ping/mq/${sent.traceId}`)
        const received = isReceived(status)
        log.push(`  [${String(i).padStart(2)}] received=${String(received)}`)
        setLines([...log])
        if (received) {
          log.push('', `✓ 端到端耗时 ${String(Math.round(performance.now() - started))} ms`)
          setLines([...log])
          setBusy(false)
          return
        }
      }
      log.push('', '✗ 12 秒内未被消费')
      setLines([...log])
    } catch (err) {
      setLines((prev) => [...prev, '', `✗ ${err instanceof Error ? err.message : String(err)}`])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <CardTitle>RocketMQ 端到端</CardTitle>
      <CardDescription>
        user-service 发 → broker → community-service 收 → 经 Feign 回查消费台账。
      </CardDescription>
      <div>
        <Button variant="outline" size="sm" onClick={run} disabled={busy} data-testid="btn-mq">
          {busy ? '追踪中…' : '发一条消息并追踪'}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto rounded border border-border bg-muted p-3 text-[11px] leading-relaxed">
        {lines.join('\n')}
      </pre>
    </Card>
  )
}
