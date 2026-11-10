import type { UseQueryResult } from '@tanstack/react-query'
import type { ProbeResult, ServiceDef } from '@/features/status/api'
import { SERVICE_DEFS, useServiceProbes } from '@/features/status/api'
import { cn } from '@/shared/lib/cn'
import { Card, CardDescription, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

type CardState = 'ok' | 'error' | 'loading'

function stateOf(query: UseQueryResult<ProbeResult> | undefined): CardState {
  if (!query || query.isPending) return 'loading'
  if (query.isError) return 'error'
  return 'ok'
}

function errorMessageOf(query: UseQueryResult<ProbeResult> | undefined): string {
  const err: unknown = query?.error
  if (err instanceof Error) return err.message
  return '未知错误'
}

function StatusCard({
  def,
  query,
}: {
  def: ServiceDef
  query: UseQueryResult<ProbeResult> | undefined
}) {
  const state = stateOf(query)
  const data = query?.data

  return (
    <Card
      className={cn(
        'relative overflow-hidden pl-4',
        // 左侧状态色条
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        state === 'ok' && 'before:bg-success',
        state === 'error' && 'before:bg-danger',
        state === 'loading' && 'before:bg-warning',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>{def.label}</CardTitle>
        <span
          className={cn(
            'text-[11px]',
            state === 'ok' && 'text-success',
            state === 'error' && 'text-danger',
            state === 'loading' && 'text-warning',
          )}
        >
          {state === 'ok' ? 'UP' : state === 'error' ? 'DOWN' : '…'}
        </span>
      </div>

      {state === 'loading' ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : null}

      {state === 'error' ? (
        <CardDescription className="mt-3 text-danger">{errorMessageOf(query)}</CardDescription>
      ) : null}

      {state === 'ok' && data ? (
        <dl className="mt-3 space-y-1 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">host</dt>
            <dd className="truncate">{data.host}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">port</dt>
            <dd>{data.port}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">latency</dt>
            <dd className={cn(data.latencyMs > 300 && 'text-warning')}>{data.latencyMs} ms</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  )
}

export function ServiceStatusGrid() {
  const results = useServiceProbes()

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICE_DEFS.map((def, index) => (
        <StatusCard key={def.key} def={def} query={results[index]} />
      ))}
    </div>
  )
}
