/**
 * 相对时间。列表里"3 小时前"比"2026-11-13 12:37"有用得多：
 * 扫视时人关心的是"新不新"，不是"哪一天几点"。
 *
 * 超过 7 天就退回绝对日期 —— "38 天前"没有信息量，日期才有。
 */
/**
 * 把服务端时间解析成 Date。
 *
 * 服务端返回的是不带时区的本地时间（LocalDateTime），直接 new Date() 会按 UTC 解析，
 * 在 +08:00 的机器上会差出 8 小时。补上 Z 之外的偏移不现实，所以按本地时间手工解析。
 */
function parseServerTime(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  return m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    : new Date(iso)
}

/**
 * 绝对日期：「2026 年 11 月 13 日」。
 *
 * 任期起止、封禁到期这类**事实性时间**必须用绝对时间：
 * 「3 天前上任」在编年史里没有信息量，而「2026 年 9 月 1 日」有。
 */
export function absoluteDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = parseServerTime(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getFullYear())} 年 ${String(d.getMonth() + 1)} 月 ${String(d.getDate())} 日`
}

/** 绝对日期 + 时间：「2026 年 11 月 13 日 12:37」。封禁到期要精确到分钟 */
export function absoluteDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = parseServerTime(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${absoluteDate(iso)} ${hh}:${mm}`
}

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return ''

  const then = parseServerTime(iso)

  const diffMs = Date.now() - then.getTime()
  if (Number.isNaN(diffMs)) return ''

  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${String(min)} 分钟前`

  const hour = Math.floor(min / 60)
  if (hour < 24) return `${String(hour)} 小时前`

  const day = Math.floor(hour / 24)
  if (day <= 7) return `${String(day)} 天前`

  return `${String(then.getMonth() + 1)} 月 ${String(then.getDate())} 日`
}
