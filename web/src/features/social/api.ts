import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData } from '@/shared/api/typed'

/**
 * 关注关系（P5.5.1）。
 *
 * ## 类型来源
 *
 * 全部来自 OpenAPI 生成物（`OkData<'getUserProfile'>` 之类），**不手写 wire 类型**：
 * 后端加字段时 `npm run gen:types` 一跑，这里立刻能发现。
 *
 * ## 为什么 profile 与 states 是两个请求
 *
 * `GET /users/{id}/profile` 是**游客可读**的公开面（p55-social.md §3.1），
 * 里面不含「我是否关注 ta」——那是登录态信息。所以前端要并发调
 * `GET /follows/states?userIds=` 聚合（ADR 0005：读路径前端聚合，后端不做 BFF）。
 *
 * ## queryKey 约定
 *
 * 写路径（关注 / 取关）成功后会失效**全部五个**相关 key：
 * `user-profile` / `following` / `followers` / `my-following` / `follow-states`。
 * 少失效哪一个都会出现"按钮变了但计数没变"这类半截更新。
 */

export type UserProfileView = OkData<'getUserProfile'>
export type FollowingPage = OkData<'listFollowing'>
export type FollowUserView = NonNullable<FollowingPage['items']>[number]
export type MyFollowing = OkData<'myFollowing'>
/** wire 层（字段全可选，因为 springdoc 不标 required） */
type WireFollowStates = OkData<'followStates'>
/** 应用内类型：收口成非可选的 boolean，组件里不用再写 `?? false` */
export type FollowState = { following: boolean; followedBy: boolean }
export type FollowStates = Record<string, FollowState>

const BASE = '/api/user'

/** 服务端单次上限 50（与 GET /users?ids= 一致），超出要分批，否则整批 40010 */
const MAX_STATE_IDS = 50

export function useUserProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () =>
      api.get<UserProfileView>(`${BASE}/users/${encodeURIComponent(userId ?? '')}/profile`),
    enabled: Boolean(userId),
    // 昵称头像与计数的变化频率远低于浏览频率；写路径会主动失效
    staleTime: 30_000,
  })
}

/**
 * ta 关注的人（游客可读）。
 *
 * 用 useInfiniteQuery 而不是"每页一个 query + 游标数组"：
 * 后者 `data` 只包含最后一页，"加载更多"会替换而不是追加。
 */
export function useFollowingList(userId: string | undefined, limit = 20) {
  return useInfiniteQuery({
    queryKey: ['following', userId],
    queryFn: ({ pageParam }) =>
      api.get<FollowingPage>(
        `${BASE}/users/${encodeURIComponent(userId ?? '')}/following?limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(userId),
  })
}

/** 关注 ta 的人（游客可读）。游标与 following 的形状一致，但服务端用不同标记拒绝串用 */
export function useFollowersList(userId: string | undefined, limit = 20) {
  return useInfiniteQuery({
    queryKey: ['followers', userId],
    queryFn: ({ pageParam }) =>
      api.get<FollowingPage>(
        `${BASE}/users/${encodeURIComponent(userId ?? '')}/followers?limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(userId),
  })
}

/**
 * 我关注的全部人（含昵称头像，上限 = 后端的 max-following，默认 200）。
 *
 * 这不是分页接口：`/following` 页的左右两栏要**一次拿全**——
 * 左栏列表 + 右栏「全部关注」的 authorIds。反复翻页会让那页发 N 次请求。
 */
export function useMyFollowing(enabled: boolean) {
  return useQuery({
    queryKey: ['my-following'],
    queryFn: () => api.get<MyFollowing>(`${BASE}/me/following/ids`),
    enabled,
  })
}

/**
 * 批量查我对这些用户的关系。
 *
 * 返回 `Record<string, {following, followedBy}>`，key 是字符串雪花 id。
 * 超过 50 个自动分批并发（服务端单批上限 50，整批超限会返回 40010）。
 *
 * `following && followedBy` 就是「互相关注」。
 */
export function useFollowStates(userIds: Array<string | undefined>, enabled: boolean) {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))].sort()
  return useQuery({
    queryKey: ['follow-states', unique.join(',')],
    queryFn: async () => {
      const chunks: string[][] = []
      for (let i = 0; i < unique.length; i += MAX_STATE_IDS) {
        chunks.push(unique.slice(i, i + MAX_STATE_IDS))
      }
      const pages = await Promise.all(
        chunks.map((chunk) =>
          api.get<WireFollowStates>(
            `${BASE}/follows/states?userIds=${chunk.map(encodeURIComponent).join(',')}`,
          ),
        ),
      )
      const out: FollowStates = {}
      for (const page of pages) {
        for (const [id, state] of Object.entries(page)) {
          out[id] = { following: state.following ?? false, followedBy: state.followedBy ?? false }
        }
      }
      return out
    },
    enabled: enabled && unique.length > 0,
  })
}

/**
 * 关注 / 取关后要失效的全部 key。
 *
 * `follow-states` 是前缀失效：一个用户的关注状态会同时影响他出现过的
 * 每一个列表/详情，逐个精确失效反而会漏。
 *
 * 不做"2 秒后再失效一次"（点赞计数那种异步投影才需要）：
 * 关注关系是同步写入的，计数在同一次查询里就是新的。
 */
function invalidateFollowData(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['follow-states'] })
  void qc.invalidateQueries({ queryKey: ['user-profile'] })
  void qc.invalidateQueries({ queryKey: ['following'] })
  void qc.invalidateQueries({ queryKey: ['followers'] })
  void qc.invalidateQueries({ queryKey: ['my-following'] })
}

/** 关注（幂等）。已关注时后端直接返回成功，不重复发事件 */
export function useFollowUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<void>(`${BASE}/users/${encodeURIComponent(userId)}/follow`),
    onSuccess: () => {
      invalidateFollowData(qc)
    },
  })
}

/** 取消关注（幂等） */
export function useUnfollowUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.del<void>(`${BASE}/users/${encodeURIComponent(userId)}/follow`),
    onSuccess: () => {
      invalidateFollowData(qc)
    },
  })
}
