/**
 * 相对时间。列表里"3 小时前"比"2026-11-13 12:37"有用得多：
 * 扫视时人关心的是"新不新"，不是"哪一天几点"。
 *
 * 超过 7 天就退回绝对日期 —— "38 天前"没有信息量，日期才有。
 */
export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return ''

  // 服务端返回的是不带时区的本地时间（LocalDateTime），直接 new Date() 会按 UTC 解析，
  // 在 +08:00 的机器上会差出 8 小时。补上 Z 之外的偏移不现实，所以按本地时间手工解析。
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  const then = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    : new Date(iso)

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
