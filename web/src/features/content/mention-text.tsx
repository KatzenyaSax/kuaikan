import { Fragment, useMemo } from 'react'
import { Link } from 'react-router'

/**
 * 正文里的 `@昵称` 渲染成可点的蓝色链接。
 *
 * ## 为什么不能靠正则"猜"哪个 @ 是有效的
 *
 * 正文是纯文本，`@林间` 和一句普通的"@ 大家"在字面上没区别。
 * 只有**写入时真的解析成功过**的 @ 才算数——所以后端把解析结果
 * 连同昵称快照一起存在评论行上（`t_comment.mentions`），
 * 这里拿到的 `mentions` 就是那份结果的读出版本。
 *
 * 未命中的 `@某人`（不存在、非本社群成员、改名之后）保持普通文字，
 * **不会**变成点不动的假链接。
 *
 * ## 为什么用昵称快照匹配而不是当前昵称
 *
 * 正文里写的就是当时的名字。对方改名后，用当前昵称去匹配会落空；
 * 用快照才能稳定地把那段文字链到同一个人。
 *
 * ## 匹配规则
 *
 * 逐个 mention 在正文里找 `@昵称`，先出现先占位（`taken` 区间跳过），
 * 避免两个昵称互相包含时重复渲染（`林` 与 `林间`）。
 */

/**
 * 生成类型里 userId/nickname 都是可选的（OpenAPI 不区分必填与非必填的差别），
 * 这里如实反映，缺失时按"不可链接"处理，不要假造空字符串。
 */
export type Mention = { userId?: string | undefined; nickname?: string | undefined }

const LINK_CLASS = 'text-primary hover:underline rounded-[2px]'

export function MentionText({ body, mentions }: {
  /** 生成类型里 body 是可选的（tombstone 时为空串），这里跟着放宽 */
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

  // 收集所有命中区间。按昵称长度倒序，让长昵称优先占位。
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
        // 点昵称不该把读者带离当前上下文——用户主页还没做，先不跳
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
