import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

export type PostDetail = OkData<'getPost'>
export type PostPage = OkData<'listPosts'>
export type PostSummary = NonNullable<PostPage['items']>[number]
export type CommentPage = OkData<'listComments'>
export type CommentView = NonNullable<CommentPage['items']>[number]
export type CreateCommentBody = RequestBody<'createComment'>
export type CreatePostBody = RequestBody<'createPost'>
export type PostsByAuthorsBody = RequestBody<'listPostsByAuthors'>
export type BatchPostsBody = RequestBody<'batchPosts'>
export type BatchPostSummary = OkData<'batchPosts'>[number]
export type UserSummary = OkData<'batchUserSummaries'>[number]

const BASE = '/api/content/posts'

/**
 * `POST /posts/batch` 的单批上限，与服务端（p55-social.md §3.3）一致。
 * 超过这个数客户端自己拆，不让用户撞 40010。
 */
const MAX_BATCH_IDS = 50

export function usePostDetail(postId: string | undefined) {
  return useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.get<PostDetail>(`${BASE}/${encodeURIComponent(postId ?? '')}`),
    enabled: Boolean(postId),
  })
}

/**
 * 社群时间线。游标分页，最新在上。
 *
 * 用 useInfiniteQuery 而不是手写"游标数组 + 多次 useQuery"：
 * 后者每一页都是一个独立的 query，`data` 只包含**最后一页**，
 * 于是"加载更多"会把列表替换掉而不是追加（这个 bug 是 L3 浏览器验收抓到的，
 * HTTP 层的分页断言完全看不出来）。
 *
 * 游标不透明：只从服务端拿、原样回传，不解析、不拼。
 * 服务端把排序标记编在里面，拿错列表的游标会被明确拒绝（40010）。
 */
export function usePostList(communityId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['posts', communityId],
    queryFn: ({ pageParam }) =>
      api.get<PostPage>(
        `${BASE}?communityId=${encodeURIComponent(communityId ?? '')}&limit=20` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    // nextCursor 为 null 表示没有下一页；返回 undefined 让 infiniteQuery 停下
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(communityId),
  })
}

/**
 * 全站最新帖（跨社群）。首页用。
 *
 * 不是"推荐"——就是按时间倒序。首页会明确标注这一点，
 * 不假装有算法。
 */
export function useLatestPosts(limit = 10) {
  return useQuery({
    queryKey: ['posts', 'latest', limit],
    queryFn: () => api.get<PostSummary[]>(`${BASE}/latest?limit=${String(limit)}`),
  })
}

/**
 * 某个作者的帖子（游客可读）。用户主页的「ta 发的帖子」与 /following 单人筛选。
 *
 * 与社群时间线共用 POST /posts 的 response 形状（`PostPage`），只是 query 参数从
 * `communityId` 换成 `authorId`。游标标记是独立的（`author-posts`）：
 * 把社群列表的游标拿到这里会被服务端明确拒绝（40010），不会静默串用。
 *
 * queryKey 里带 `author` 段：与`社群列表`的 `['posts', communityId]` 区分开，
 * 否则两边会互相覆盖缓存（communityId 和 userId 都是字符串，前缀相同）。
 */
export function useAuthorPosts(authorId: string | undefined, limit = 20) {
  return useInfiniteQuery({
    queryKey: ['posts', 'author', authorId],
    queryFn: ({ pageParam }) =>
      api.get<PostPage>(
        `${BASE}?authorId=${encodeURIComponent(authorId ?? '')}&limit=${String(limit)}` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(authorId),
  })
}

/**
 * 一批作者的帖子（/following 的「全部关注」）。**需要登录**。
 *
 * 用 POST body 而不是把 200 个 id 拼进 query（p55-social.md §3.3）。
 * 空数组时 `enabled: false`：不该为了一个必然返回空页的请求去惊动后端，
 * 也避免 `POST ... { authorIds: [] }` 在日志里制造噪声。
 *
 * authorIds 排序后再进 queryKey：同一批作者以不同顺序传进来必须命中同一个缓存，
 * 否则翻一页、切一次选人就会白白重拉。
 */
export function usePostsByAuthors(authorIds: string[], limit = 20) {
  const unique = [...new Set(authorIds.filter((id) => Boolean(id)))].sort()
  return useInfiniteQuery({
    queryKey: ['posts', 'by-authors', unique.join(',')],
    queryFn: ({ pageParam }) =>
      api.post<PostPage>(`${BASE}/by-authors`, {
        authorIds: unique,
        limit,
        // exactOptionalPropertyTypes：无游标时**省略**该字段，不能传 undefined
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: unique.length > 0,
  })
}

/**
 * 批量取帖子摘要（P5.5.3）。「我的收藏」用它把 `(postId, createdAt)` 补成可渲染的行。
 *
 * 三件事要注意：
 *   1. **超 50 自动分批**：服务端上限是 50（超了 40010）。收藏列表滑到第 3 页时
 *      postId 会超过 50 个，分批是客户端的责任，不是让用户看到报错。
 *   2. 空数组 `enabled: false`：收藏为空时不该发一个必然返回 [] 的请求。
 *   3. **只返回 `status = 1` 的帖子**。所以调用方用「返回的 Map 里缺席」来判定
 *      「这篇已删」—— 这正是删帖占位不需要额外字段的原因。
 */
export function useBatchPosts(ids: string[]) {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))].sort()
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += MAX_BATCH_IDS) {
    chunks.push(unique.slice(i, i + MAX_BATCH_IDS))
  }
  return useQuery({
    queryKey: ['posts', 'batch', unique.join(',')],
    queryFn: async () => {
      const pages = await Promise.all(
        chunks.map((chunk) => api.post<BatchPostSummary[]>(`${BASE}/batch`, { ids: chunk })),
      )
      return pages.flat()
    },
    enabled: unique.length > 0,
    // 收藏列表反复翻页时同一批 id 应该命中缓存；帖子被判删由 30 秒内的窗口接受
    staleTime: 30_000,
  })
}

export function useCreatePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePostBody) => api.post<PostDetail>(BASE, body),
    onSuccess: () => {
      // 社群帖列表在 P2.4 才会用同一个 key 拉
      void queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

/**
 * 删帖（软删）。作者删自己、社群管理员删本社群内任意帖子走的是同一个端点（P7.2）。
 *
 * 清 ES 与扣减计数在服务端，前端只需要把两处缓存弄脏：帖子详情与列表。
 * 收藏列表用「返回的 Map 里缺席」判已删（见 useBatchPosts），所以也要失效。
 */
export function useDeletePost(postId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.del<void>(`${BASE}/${encodeURIComponent(postId ?? '')}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['post', postId] })
      void queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

/**
 * 批量取作者摘要。
 *
 * 帖子详情里**只有 authorId**（ADR 0009），昵称头像要靠这个接口现取。
 * 一屏多个作者也只发一次请求 —— 这正是它存在的理由。
 *
 * 用 staleTime 让作者信息在页面间复用时不必反复拉：昵称头像的变化频率
 * 远低于帖子浏览频率，而"改了昵称马上全站生效"的体验由 P1.6 的
 * 失效逻辑保证（我们这里只缓存几分钟）。
 */
export function useUserSummaries(ids: Array<string | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
  return useQuery({
    queryKey: ['users', unique.join(',')],
    queryFn: () => api.get<UserSummary[]>(`/api/user/users?ids=${unique.map(encodeURIComponent).join(',')}`),
    enabled: unique.length > 0,
    staleTime: 60_000,
  })
}

/** 按 id 取单个作者摘要；查不到时返回 null，由调用方降级成"已注销用户" */
export function pickAuthor(
  summaries: UserSummary[] | undefined,
  userId: string | undefined,
): UserSummary | null {
  if (!summaries || !userId) return null
  return summaries.find((s) => s.userId === userId) ?? null
}

const COMMENT_BASE = '/api/content'

/**
 * 一级评论列表。时间正序，游标分页。
 *
 * 与帖子列表一样用 useInfiniteQuery —— 手写"每页一个 query + 游标数组"
 * 会导致加载更多替换而不是追加（P2.4 踩过）。
 */
export type CommentSort = 'time' | 'hot'

/**
 * 一级评论。**默认时间序**（老的在上）——评论读起来像对话。
 *
 * sort 进 queryKey：切排序就是换一个 query，游标不会串。
 * 服务端把排序标记编进游标，拿 A 排序的游标去请求 B 排序会被明确拒绝（40010）。
 */
export function useComments(postId: string | undefined, sort: CommentSort = 'time') {
  return useInfiniteQuery({
    queryKey: ['comments', postId, sort],
    queryFn: ({ pageParam }) =>
      api.get<CommentPage>(
        `${COMMENT_BASE}/posts/${encodeURIComponent(postId ?? '')}/comments` +
          `?sort=${sort}&limit=20` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(postId),
  })
}

/** 某个一级评论下的回复。两级平铺：不管嵌套多深都在这一层返回 */
export function useReplies(rootCommentId: string | null) {
  return useInfiniteQuery({
    queryKey: ['replies', rootCommentId],
    queryFn: ({ pageParam }) =>
      api.get<CommentPage>(
        `${COMMENT_BASE}/comments/${encodeURIComponent(rootCommentId ?? '')}/replies?limit=50` +
          (pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(rootCommentId),
  })
}

export function useCreateComment(postId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCommentBody) =>
      api.post<CommentView>(`${COMMENT_BASE}/posts/${encodeURIComponent(postId ?? '')}/comments`, body),
    onSuccess: () => {
      // commentCount 是强一致的，详情与评论列表都要刷新
      void queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      void queryClient.invalidateQueries({ queryKey: ['replies'] })
      void queryClient.invalidateQueries({ queryKey: ['post', postId] })
    },
  })
}

export function useDeleteComment(postId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      api.del<void>(`${COMMENT_BASE}/comments/${encodeURIComponent(commentId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      void queryClient.invalidateQueries({ queryKey: ['replies'] })
      void queryClient.invalidateQueries({ queryKey: ['post', postId] })
    },
  })
}

/** 把评论相关的 authorId / replyToUserId 一次性收集起来，用同一个批量摘要接口取 */
export function collectCommentUserIds(comments: CommentView[]): string[] {
  const ids = new Set<string>()
  for (const c of comments) {
    if (c.authorId) ids.add(c.authorId)
    if (c.replyToUserId) ids.add(c.replyToUserId)
  }
  return [...ids]
}
