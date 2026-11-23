import { Fragment, useMemo } from 'react'
import { Link } from 'react-router'

export type Mention = { userId?: string | undefined; nickname?: string | undefined }

const LINK_CLASS =
  'rounded-md bg-[var(--color-primary-soft)] px-1 py-0.5 font-semibold text-primary transition-colors hover:underline underline-offset-2'

export function MentionText({
  body,
  mentions,
}: {
  body?: string | undefined
  mentions?: Mention[] | null | undefined
}) {
  const text = body ?? ''
  const nodes = useMemo(() => splitByMentions(text, mentions ?? []), [text, mentions])
  return <>{nodes}</>
}

function splitByMentions(body: string, mentions: Mention[]) {
  if (!mentions.length) {
    return [body]
  }

  const spans: { start: number; end: number; mention: Mention }[] = []
  const ordered = [...mentions].sort(
    (a, b) => (b.nickname?.length ?? 0) - (a.nickname?.length ?? 0),
  )
  for (const m of ordered) {
    if (!m.nickname || !m.userId) continue
    const token = `@${m.nickname}`
    let from = 0
    for (;;) {
      const at = body.indexOf(token, from)
      if (at < 0) break
      const end = at + token.length
      const overlaps = spans.some((s) => at < s.end && end > s.start)
      if (!overlaps) spans.push({ start: at, end, mention: m })
      from = end
    }
  }
  if (!spans.length) {
    return [body]
  }
  spans.sort((a, b) => a.start - b.start)

  const out: React.ReactNode[] = []
  let cursor = 0
  for (const s of spans) {
    if (s.start > cursor) {
      out.push(<Fragment key={`t${String(cursor)}`}>{body.slice(cursor, s.start)}</Fragment>)
    }
    out.push(
      <Link
        key={`m${String(s.start)}`}
        to={`/u/${encodeURIComponent(s.mention.userId ?? '')}`}
        className={LINK_CLASS}
        onClick={(e) => e.stopPropagation()}
      >
        {body.slice(s.start, s.end)}
      </Link>,
    )
    cursor = s.end
  }
  if (cursor < body.length) {
    out.push(<Fragment key="tail">{body.slice(cursor)}</Fragment>)
  }
  return out
}
