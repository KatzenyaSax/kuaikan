import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

export type CommunityPage = OkData<'listCommunities'>
export type CommunitySummary = NonNullable<CommunityPage['items']>[number]
export type CommunityDetail = OkData<'getCommunity'>
export type CreateCommunityBody = RequestBody<'createCommunity'>

const BASE = '/api/community/communities'

/** 用户主页「ta 加入的社群」的路径。首段是 users，与 /communities/... 错开 */
const USERS_BASE = '/api/community/users'

/**
 * 社群列表。游客可读。
 *
 * 游标是**不透明字符串**：前端只回传，不解析、不拼。
 * 服务端会把排序标记编进去，跨排序复用会返回 40010。
 */
export function useCommunityList(cursor: string | null) {
  return useQuery({
    queryKey: ['community', 'list', cursor],
    queryFn: () => api.get<CommunityPage>(`${BASE}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  })
}

/**
 * 社群详情。游客可读，响应里没有任何按查看者变化的字段。
 *
 * 路径里用名称（不是 id）：社群名本身就是标识，服务端会做规范化，
 * 所以 /c/FRONTEND 与 /c/frontend 命中同一个社群。
 */
export function useCommunityDetail(name: string | undefined) {
  return useQuery({
    queryKey: ['community', 'detail', name],
    queryFn: () => api.get<CommunityDetail>(`${BASE}/${encodeURIComponent(name ?? '')}`),
    enabled: Boolean(name),
  })
}

/**
 * 指定用户已加入的社群（游客可读）。用户主页的「社群」Tab。
 *
 * 与 /mine 是同一查询结构（joined_at DESC, id DESC），但游标标记不同：
 * 拿 /mine 的游标到这里会被服务端明确拒绝（40010）。
 *
 * 用户不存在时服务端返回空页（读路径不做跨服务校验，ADR 0005），
 * 所以前端不需要区分「不存在」与「没加入任何社群」。
 */
export function useUserCommunities(userId: string | undefined, limit = 20) {
  return useInfiniteQuery({
    queryKey: ['community', 'user', userId],
    queryFn: ({ pageParam }) =>
      api.get<CommunityPage>(
        `${USERS_BASE}/${encodeURIComponent(userId ?? '')}/communities?limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(userId),
  })
}

/** 我加入的社群。需要登录；左栏的"我加入的社群"与加入按钮的初始状态都靠它 */
export function useMyCommunities(enabled = true) {
  return useQuery({
    queryKey: ['community', 'mine'],
    queryFn: () => api.get<CommunityPage>(`/api/community/mine?limit=50`),
    enabled,
  })
}

/**
 * 加入 / 退出。
 *
 * 两者都是**幂等**的：重复点击不会让 member_count 多算或少算。
 * 成功后要失效三处：
 *   - mine：左栏列表与按钮状态
 *   - detail：member_count 变了
 *   - list：首页卡片上的成员数
 */
export function useMembership() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['community', 'mine'] })
    void queryClient.invalidateQueries({ queryKey: ['community', 'detail'] })
    void queryClient.invalidateQueries({ queryKey: ['community', 'list'] })
    // 加入/退出改变 joined，而社群页的按钮状态现在以 /my-status 为准（P7）
    void queryClient.invalidateQueries({ queryKey: ['community', 'my-status'] })
  }
  const join = useMutation({
    mutationFn: (name: string) =>
      api.post<OkData<'joinCommunity'>>(`${BASE}/${encodeURIComponent(name)}/membership`),
    onSuccess: invalidate,
  })
  const leave = useMutation({
    mutationFn: (name: string) =>
      api.del<OkData<'leaveCommunity'>>(`${BASE}/${encodeURIComponent(name)}/membership`),
    onSuccess: invalidate,
  })
  return { join, leave }
}

export function useCreateCommunity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCommunityBody) => api.post<CommunityDetail>(BASE, body),
    onSuccess: () => {
      // 新社群会出现在列表最前面，让首页立刻能看见
      void queryClient.invalidateQueries({ queryKey: ['community', 'list'] })
      // **创建者同时也是第一个成员**，所以 /mine 也变了。
      // 不失效的话，刚建完的社群页会显示"加入社群"而不是"退出社群"——
      // 因为加入状态是从 /mine 推导的，而缓存里还是创建前的列表。
      void queryClient.invalidateQueries({ queryKey: ['community', 'mine'] })
    },
  })
}

// ================================================================ P7 治理
//
// 与上面公开读取的区分不在路径前缀，而在**权限**：这一节的写端点都要求
// 调用者是当前社群管理员（t_community.owner_id），游客/普通成员的正确答案是
// 403 + 41007。所以 /my-status 做成"登录才发"的查询，未登录时它是静默的。

export type MyCommunityStatus = OkData<'getMyCommunityStatus'>
export type CommunityMember = NonNullable<OkData<'listCommunityMembers'>['items']>[number]
export type CommunityBan = NonNullable<OkData<'listCommunityBans'>['items']>[number]
export type CommunityHistoryEvent = NonNullable<
  OkData<'listCommunityHistory'>['items']
>[number]
export type AdminTerm = NonNullable<OkData<'listCommunityAdminHistory'>['items']>[number]
export type UpdateCommunityInfoBody = RequestBody<'updateCommunityInfo'>
export type TransferCommunityBody = RequestBody<'transferCommunityAdmin'>
export type BanCommunityMemberBody = RequestBody<'banCommunityMember'>

/** 历史筛选。值是**后端契约里的字符串**，不是前端自造的可读标签 */
export type HistoryCategory = 'all' | 'milestone' | 'moderation'

/**
 * 我在这个社群里的状态：`{joined, admin, banned, banReason, bannedUntil}`。
 *
 * 一次回答三个按钮问题（加入 / 管理 / 被封禁），因此社群页不需要同时拉
 * /mine（分页，可能不含这一条）与封禁名单（只有管理员能读）。
 *
 * **未登录时不发请求**：这是登录态端点，游客必然 401，靠 401 再弹提示
 * 只会制造一次无意义的续期/登出噪声。
 */
export function useMyCommunityStatus(name: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['community', 'my-status', name],
    queryFn: () =>
      api.get<MyCommunityStatus>(`${BASE}/${encodeURIComponent(name ?? '')}/my-status`),
    enabled: enabled && Boolean(name),
    // 按钮状态不该在每次导航时闪一下：写入路径会主动失效
    staleTime: 30_000,
  })
}

/**
 * 让所有"社群治理"缓存失效。
 *
 * 用**前缀**失效而不是逐条精确失效：封禁会同时改变成员数、成员名单、封禁名单、
 * 治理记录与"我的状态"，漏掉任何一个都会出现"按钮变了但列表没变"的半截更新。
 */
function invalidateGovernance(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['my-status', 'members', 'bans', 'history', 'admin-history', 'detail', 'list', 'mine']) {
    void queryClient.invalidateQueries({ queryKey: ['community', key] })
  }
  // 封禁会改 member_count，用户主页的社群 Tab 也带着这个数字
  void queryClient.invalidateQueries({ queryKey: ['community', 'user'] })
}

/**
 * 编辑社群信息（仅管理员）。
 *
 * 契约是 **null = 不改、"" = 清空**（UpdateCommunityInfoRequest 的注释）。
 * 前端表单把三个字段都发成字符串：输入框被清空时就是 ""，正好表达"清空"，
 * 不需要额外的"是否修改过"标记，也不会出现"只改公告却顺手抹掉头像"。
 */
export function useUpdateCommunityInfo(name: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateCommunityInfoBody) =>
      api.put<CommunityDetail>(`${BASE}/${encodeURIComponent(name ?? '')}`, body),
    onSuccess: (detail) => {
      // 响应就是更新后的详情：直接写回缓存，社群页立刻拿到新头像/公告
      queryClient.setQueryData(['community', 'detail', name], detail)
      invalidateGovernance(queryClient)
    },
  })
}

/** 转让管理员（直接交接，二次确认在前端）。成功后原管理员降为普通成员 */
export function useTransferCommunityAdmin(name: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TransferCommunityBody) =>
      api.post<CommunityDetail>(`${BASE}/${encodeURIComponent(name ?? '')}/transfer`, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(['community', 'detail', name], detail)
      invalidateGovernance(queryClient)
    },
  })
}

/** 在社成员（仅管理员）。按加入时间倒序游标分页，管理页的封禁/转让都基于它 */
export function useCommunityMembers(name: string | undefined, enabled = true, limit = 50) {
  return useInfiniteQuery({
    queryKey: ['community', 'members', name],
    queryFn: ({ pageParam }) =>
      api.get<OkData<'listCommunityMembers'>>(
        `${BASE}/${encodeURIComponent(name ?? '')}/members?limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: enabled && Boolean(name),
  })
}

/** 生效中的封禁名单（仅管理员）。已解封与自然过期的不在这里 */
export function useCommunityBans(name: string | undefined, enabled = true, limit = 50) {
  return useInfiniteQuery({
    queryKey: ['community', 'bans', name],
    queryFn: ({ pageParam }) =>
      api.get<OkData<'listCommunityBans'>>(
        `${BASE}/${encodeURIComponent(name ?? '')}/bans?limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: enabled && Boolean(name),
  })
}

/** 封禁用户（仅管理员）。durationDays 只允许 1 / 7 / 30，null = 永久 */
export function useBanCommunityMember(name: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: BanCommunityMemberBody) =>
      api.post<CommunityBan>(`${BASE}/${encodeURIComponent(name ?? '')}/bans`, body),
    onSuccess: () => {
      invalidateGovernance(queryClient)
    },
  })
}

/** 解封（幂等）。本来没被封也返回成功 */
export function useUnbanCommunityMember(name: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.del<void>(`${BASE}/${encodeURIComponent(name ?? '')}/bans/${encodeURIComponent(userId)}`),
    onSuccess: () => {
      invalidateGovernance(queryClient)
    },
  })
}

/**
 * 社群编年史（游客可读）。
 *
 * `category` 进 queryKey：服务端把分类编进游标，拿「全部」的游标去查「治理记录」
 * 会被明确拒绝（40010）。所以切筛选就是换一个 query，两个分类的翻页状态互不干扰。
 */
export function useCommunityHistory(
  name: string | undefined,
  category: HistoryCategory = 'all',
  limit = 20,
) {
  return useInfiniteQuery({
    queryKey: ['community', 'history', name, category],
    queryFn: ({ pageParam }) =>
      api.get<OkData<'listCommunityHistory'>>(
        `${BASE}/${encodeURIComponent(name ?? '')}/history?category=${category}&limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: Boolean(name),
  })
}

/** 历代管理员（游客可读）。不分页：任数量级是个位数 */
export function useCommunityAdminHistory(name: string | undefined) {
  return useQuery({
    queryKey: ['community', 'admin-history', name],
    queryFn: () =>
      api.get<OkData<'listCommunityAdminHistory'>>(
        `${BASE}/${encodeURIComponent(name ?? '')}/admins/history`,
      ),
    enabled: Boolean(name),
    staleTime: 30_000,
  })
}
