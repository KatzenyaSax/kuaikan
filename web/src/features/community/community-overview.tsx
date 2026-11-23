import { useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import {
  useCommunityDetail,
  useMembership,
  useMyCommunities,
  useMyCommunityStatus,
} from '@/features/community/api'
import { pickAuthor, useUserSummaries } from '@/features/content/api'
import { authErrorMessage } from '@/features/auth/auth-error'
import { useSession } from '@/features/auth/session'
import { Avatar } from '@/shared/ui/avatar'
import { Button, buttonClass } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/toast'
import { absoluteDateTime } from '@/shared/lib/time'

/** hero 渐显的错开。80ms 一档，再多就会让人等 */
const heroDelay = (ms: number): CSSProperties => ({ '--hero-delay': `${ms}ms` }) as CSSProperties

/**
 * 社群概览 = 双栏布局的右栏**空态**（`/c/:name` 还没选帖子时）。
 *
 * 空态放社群概览而不是"请从左边选一个帖子"：用户进来先要知道这是个什么社群，
 * 而不是被要求做一件他还没理解的事。
 *
 * "我加没加入 / 我是不是管理员 / 我被没被封"都从 `/my-status` 推导（P7）；
 * 公开详情里没有 viewer 字段（放行 = 匿名），所以 /mine 只作为它回来之前的回退。
 *
 * 排版是**营销页风**（与首页 hero 同一套语言）：大号社群名（display 档）、
 * 一行成员数、一段简介、两个胶囊按钮。**不用卡片**，靠留白分区。
 * 右栏是白底，左栏是浅底 —— 两栏靠底色分开，不需要一条竖线再强调一次。
 */
export function CommunityOverview() {
  const { name } = useParams<{ name: string }>()
  const detail = useCommunityDetail(name)
  const status = useSession((s) => s.status)
  const authed = status === 'authenticated'
  const mine = useMyCommunities(authed)
  // 已登录才发：/my-status 是登录态端点，游客必然 401（P7）
  const myStatus = useMyCommunityStatus(name, authed)
  // 管理员昵称头像不在社群详情里（跨服务引用，ADR 0009），要单独批量取一次。
  // **必须写在所有早返回之前**：hook 不能在条件分支里跳过。
  const ownerSummaries = useUserSummaries([detail.data?.ownerId])
  const { join, leave } = useMembership()
  const [actionError, setActionError] = useState<string | null>(null)

  // 「我加入没加入」以 /my-status 为准，/mine 作为它回来之前的回退：
  // /mine 是分页的（limit=50），社群一多就可能不含当前这一个，
  // 而 /my-status 是精确的单点查询。被封禁时后端返回 joined=false —— 那是正确的答案：
  // 封禁会把在社的成员行置为已退出。
  const joined =
    myStatus.data !== undefined
      ? myStatus.data.joined === true
      : (mine.data?.items ?? []).some((c) => c.name === detail.data?.name)
  const banned = myStatus.data?.banned === true
  const isAdmin = myStatus.data?.admin === true
  const busy = join.isPending || leave.isPending

  if (detail.isPending) {
    return (
      <div className="px-8 pb-24 pt-12 md:px-10">
        <div className="mx-auto max-w-[34rem]">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="mt-6 h-9 w-52" />
          <Skeleton className="mt-4 h-4 w-24" />
          <Skeleton className="mt-8 h-20 w-full" />
        </div>
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="px-8 pb-24 pt-12 md:px-10">
        <p className="m-0 text-body text-danger" data-testid="community-error">
          {authErrorMessage(detail.error)}
        </p>
        <Link to="/" className="mt-3 inline-block text-aux text-primary hover:underline">
          返回首页
        </Link>
      </div>
    )
  }

  const community = detail.data
  const owner = pickAuthor(ownerSummaries.data, community.ownerId)
  // 摘要没回来时不要渲染"已注销用户"——那会闪一下又变，比留白更像 bug
  const ownerName = owner?.nickname ?? (ownerSummaries.isPending ? '…' : '已注销用户')

  return (
    <div className="px-8 pb-24 pt-12 md:px-10" data-testid="community-page">
      <div className="mx-auto max-w-[34rem]">
        <div className="hero-in" style={heroDelay(0)}>
          {/* 有头像就显示头像，没有就退回首字母渐变（Avatar 内部处理协议白名单） */}
          <Avatar name={community.name ?? ''} url={community.avatarUrl ?? null} size={60} />
        </div>

        <h1
          className="hero-in m-0 mt-6 text-display [overflow-wrap:anywhere]"
          style={heroDelay(40)}
          data-testid="community-name"
        >
          {community.name}
        </h1>

        <p className="hero-in m-0 mt-3 text-aux text-faint" style={heroDelay(80)}>
          {community.memberCount} 成员
        </p>

        {/*
          当前管理员。

          昵称头像**不在社群详情里**（跨服务引用，ADR 0009），所以要单独批量取一次。
          这里只取一个 id，用的是与其他地方同一个 `useUserSummaries`，
          所以从帖子页点进来时这份数据通常已经在缓存里。
        */}
        {community.ownerId ? (
          <div
            className="hero-in mt-5 flex items-center gap-2.5 text-aux"
            style={heroDelay(100)}
            data-testid="community-admin"
          >
            <span className="text-faint">当前管理员</span>
            <Link
              to={`/u/${encodeURIComponent(community.ownerId)}`}
              className="inline-flex min-w-0 items-center gap-2 transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
              data-testid="community-admin-link"
            >
              <Avatar
                url={owner?.avatarUrl ?? null}
                name={owner?.nickname ?? ''}
                size={22}
              />
              <span className="truncate text-body font-medium text-foreground">
                {ownerName}
              </span>
            </Link>
            <span className="inline-flex h-[20px] items-center rounded-full bg-fill px-2 text-caption font-medium text-muted-foreground">
              管理员
            </span>
          </div>
        ) : null}

        {/* 公告：纯文本、保留换行。没有公告就整块不渲染，不占位 */}
        {community.announcement ? (
          <div
            className="hero-in mt-8 rounded-[var(--radius-lg)] bg-surface p-4"
            style={heroDelay(110)}
            data-testid="community-announcement"
          >
            <p className="m-0 text-caption font-medium text-muted-foreground">社群公告</p>
            <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-body leading-[1.75] text-foreground">
              {community.announcement}
            </p>
          </div>
        ) : null}

        <div className="hero-in mt-7" style={heroDelay(120)}>
          {community.description ? (
            <p
              className="m-0 whitespace-pre-wrap text-read leading-[1.8]"
              data-testid="community-desc"
            >
              {community.description}
            </p>
          ) : (
            <p className="m-0 text-body text-faint">这个社群还没有简介</p>
          )}
        </div>

        <div
          className="hero-in mt-9 flex flex-wrap items-center gap-x-7 gap-y-3"
          style={heroDelay(160)}
        >
          {!authed ? (
            <a
              href={`/login?returnTo=${encodeURIComponent(`/c/${name ?? ''}`)}`}
              className={buttonClass({ size: 'lg' })}
              data-testid="link-login-to-join"
            >
              登录后可以加入社群
            </a>
          ) : banned ? (
            // 被封禁时**加入和发帖都不给点**：给一个可点的按钮然后弹错，
            // 等于让用户用一次失败去发现一个早就能告诉他的事实。
            <Button size="lg" disabled data-testid="btn-join-community">
              暂时无法加入
            </Button>
          ) : joined ? (
            <>
              {/* 发帖是这个页面唯一的主操作 —— 每屏最多一个 primary */}
              <Link
                to={`/c/${encodeURIComponent(name ?? '')}/new`}
                className={buttonClass({ size: 'lg' })}
                data-testid="link-new-post"
              >
                发帖
              </Link>
              {/* 退出是第三级操作：不被强调，但也不藏起来 */}
              <Button
                variant="link"
                disabled={busy}
                onClick={() => {
                  setActionError(null)
                  leave.mutate(community.name ?? '', {
                    onSuccess: () => toast('已退出社群'),
                    onError: (err) => setActionError(authErrorMessage(err)),
                  })
                }}
                data-testid="btn-leave-community"
              >
                {busy ? '处理中…' : '退出社群'}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              disabled={busy}
              onClick={() => {
                setActionError(null)
                join.mutate(community.name ?? '', {
                  onSuccess: () => toast('已加入社群'),
                  // 41006 的 message 已由后端拼好「原因 + 解封时间」，
                  // authErrorMessage 原样透传，不用前端静态文案覆盖
                  onError: (err) => setActionError(authErrorMessage(err)),
                })
              }}
              data-testid="btn-join-community"
            >
              {busy ? '处理中…' : '加入社群'}
            </Button>
          )}
        </div>

        {/* 封禁提示条：让“为什么不能发帖”在页面上有答案，而不是只有按钮灰着 */}
        {banned ? (
          <div
            className="hero-in mt-6 rounded-[var(--radius-md)] bg-[rgba(200,30,30,0.06)] px-4 py-3"
            style={heroDelay(180)}
            data-testid="community-banned-banner"
          >
            <p className="m-0 text-aux font-medium text-danger">你已被该社群封禁</p>
            {myStatus.data?.banReason ? (
              <p className="m-0 mt-1 text-caption leading-[1.6] text-muted-foreground">
                原因：{myStatus.data.banReason}
              </p>
            ) : null}
            <p className="m-0 mt-1 text-caption leading-[1.6] text-muted-foreground">
              {myStatus.data?.bannedUntil
                ? `解封时间：${absoluteDateTime(myStatus.data.bannedUntil)}`
                : '永久封禁'}
            </p>
          </div>
        ) : null}

        {actionError ? (
          <p className="mt-4 text-aux text-danger" data-testid="membership-error">
            {actionError}
          </p>
        ) : null}

        {/*
          两个入口。

          社群历史是**公开**的公共记忆（连治理记录也公开，见 p7-community-admin.md），
          所以游客也看得到；管理台只有当前管理员可见 —— 隐藏入口不是权限（后端仍是唯一门禁），
          而是不给普通用户展示一个点进去必然 403 的按钮。
        */}
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-6">
          <Link
            to={`/c/${encodeURIComponent(name ?? '')}/history`}
            className="text-aux text-primary transition-colors duration-[var(--duration-fast)] hover:text-primary-hover hover:underline"
            data-testid="community-history-link"
          >
            社群历史 ›
          </Link>
          {isAdmin ? (
            <Link
              to={`/c/${encodeURIComponent(name ?? '')}/manage`}
              className="text-aux text-primary transition-colors duration-[var(--duration-fast)] hover:text-primary-hover hover:underline"
              data-testid="community-manage-link"
            >
              管理社群 ›
            </Link>
          ) : null}
        </div>

        <p className="mt-14 text-aux text-muted-foreground">
          从左边选一篇帖子开始读。
        </p>
      </div>
    </div>
  )
}
