# P5.5 社交关系与个人中心 · 设计

> 上游：[`roadmap.md`](./roadmap.md) P5.5 行、[`architecture.md`](./architecture.md) §2 §5 §6 §9、[`CONTEXT.md`](../../CONTEXT.md)
> 相关裁决：ADR [0003](./../adr/0003-gateway-jwt-redis-whitelist.md)（网关唯一验签与白名单）、
> ADR [0004](./../adr/0004-like-consistency-outbox.md)（本地消息表）、
> ADR [0005](./../adr/0005-no-bff-frontend-aggregation.md)（读路径前端并发聚合）、
> ADR [0006](./../adr/0006-schema-per-service.md)（独立 schema 无跨库 JOIN）、
> ADR [0009](./../adr/0009-author-summary-live-fetch.md)（作者实时拉取）、
> ADR [0010](./../adr/0010-count-consistency.md)（计数是派生状态，能算就别存）

---

## 1. 边界

**做**：
1. **关注关系（`user-service`）**：关注 / 取关（幂等）、单人关注上限 200、关注状态批量查询（含互关判定）、关注列表 / 粉丝列表（游标分页）、关注数 / 粉丝数。
2. **关注通知（`FOLLOW` 第五类消息）**：`user-service` 复用 `kuaikan-common-outbox` 发布 `kuaikan_user_followed`；`notification-service` 与前端消息抽屉由四类扩为五类（点赞 / 评论 / @ / 关注 / 系统），含 24h 同人冷却防刷，逐条展示不折叠，点击跳 `/u/{actorId}`。
3. **关注流页 `/following`**：双栏列表形态——左栏「全部关注」+ 已关注用户列表，右栏对应帖子时间线（点帖子跳转详情页）；未登录展示引导登录空态。
4. **用户主页 `/u/:userId`**：全量对游客公开可读；展示头像/昵称/关注数/粉丝数、关注按钮（看自己时显示「编辑资料」跳 `/me`）、四个 Tab（ta 发的帖子 / ta 加入的社群 / 关注列表 / 粉丝列表）；同步打通帖子详情与评论区的作者点击跳转 `/u/:userId`，并在帖子详情作者行附快捷关注按钮。
5. **个人中心 `/me` 增强**：顶部增加「查看我的主页」跳转 `/u/:myId`；页内新增「修改密码」（校验旧密码 + 全端强制下线跳 `/login`）与「我的收藏」（游标分页 + 批量补齐帖子摘要 + 已删帖占位与取消收藏）。

**不做**：

| 不做 | 理由 |
|---|---|
| `t_user` 新增个人简介 `bio` 字段 | 保持 `t_user` 零结构侵入，避免资料编辑与摘要 DTO 扩散 |
| 推模式（Fan-out on write）关注流 | 容量基线 1 万注册用户 + 单人关注上限 200，`author_id IN (...)` 读时拉取完全够用，无须引入独立时间线存储与退关清理 |
| 在 `/following` 右栏就地渲染帖子详情 | 保持与 `/c/:name/p/:postId` 单一规范 URL，不制造第二套帖子详情路由 |
| 忘记密码（未登录邮箱重置） | 本期只做已登录态修改密码；未登录重置涉及防暴力枚举与邮件通道真实化，留到 P7 上线前 |
| 关注消息折叠（"X 等 N 人关注了你"） | 关注消息需逐条点击进对方主页或回关，合并会丢失具体关注者入口 |
| 收藏列表公开到 `/u/:userId` | `CONTEXT.md` 约定收藏是私密行为，仅本人在 `/me` 可见 |
| 互相关注专属分组 / 悄悄关注 / 拉黑 | 一期无此需求，避免关系状态机过早复杂化 |

---

## 2. 错误码契约（P5.5.0 冻结）

在 `contract/error-codes.json` 中追加 5 个错误码，同步后端 `AuthErrorCode` / `UserErrorCode`（位于 `kuaikan-common` 或 `user-service`）并重新执行 `npm run gen:contract` 与 `node deploy/bin/check-contract.mjs`：

| code | name | HTTP | owner | message | 说明 |
|---|---|---|---|---|---|
| `40207` | `PASSWORD_INCORRECT` | **200** | `auth` | `原密码错误` | **严禁返回 401**：否则前端 401 拦截器会触发 refresh 循环（与 `40206` 同理） |
| `40208` | `PASSWORD_UNCHANGED` | **200** | `auth` | `新密码不能与原密码相同` | 与当前哈希比对命中时拒绝，避免无意义的全端踢下线 |
| `40209` | `USER_NOT_FOUND` | **404** | `user` | `用户不存在` | 查询主页计数/关注目标不存在时返回 |
| `40210` | `CANNOT_FOLLOW_SELF` | **200** | `user` | `不能关注自己` | `followerId == followeeId` |
| `40211` | `FOLLOW_LIMIT_EXCEEDED` | **200** | `user` | `关注人数已达上限` | 超过单人关注上限（默认 200，可配置） |

---

## 3. 端点冻结与网关白名单（P5.5.0 冻结）

### 3.1 `user-service`

```text
# 关注写路径（均需登录）
POST   /api/user/users/{userId}/follow                      关注目标用户（幂等）
DELETE /api/user/users/{userId}/follow                      取消关注（幂等）

# 关注读路径
GET    /api/user/users/{userId}/profile                     游客可读；返回用户资料 + followingCount + followerCount
GET    /api/user/users/{userId}/following?cursor=&limit=    游客可读；ta 关注的人（游标分页，返回 userId/nickname/avatarUrl/followedAt）
GET    /api/user/users/{userId}/followers?cursor=&limit=    游客可读；关注 ta 的人（游标分页，返回 userId/nickname/avatarUrl/followedAt）
GET    /api/user/follows/states?userIds=1,2,3               登录；批量查询我对目标用户的关系：{ userId: { following, followedBy } }
GET    /api/user/me/following/ids                           登录；返回我关注的全部 followeeId（上限 200，供 /following 全部关注流拉帖）

# 修改密码（需登录）
POST   /api/user/auth/password                              body: { oldPassword, newPassword }
```

要点：
- `POST /api/user/users/{userId}/follow`：校验不能关注自己（`40210`）、校验目标用户存在（`40209`）、若尚未关注则校验当前关注数 `< kuaikan.follow.max-following`（默认 200，超限 `40211`）；`INSERT IGNORE` 写入 `t_user_follow`，**仅当 `affectedRows == 1` 时同事务写 `t_outbox`**。已关注时直接返回成功（幂等，不重复写事件）。
- `DELETE /api/user/users/{userId}/follow`：物理删除该行（关注关系不是内容，不适用逻辑删除，与 `t_interaction` 取消点赞一致）；未关注时直接返回成功（幂等，不发事件）。
- `GET /api/user/users/{userId}/profile`：目标用户不存在返回 `40209`；响应不含任何当前用户私有字段（遵守游客读路径纯洁性），登录态的「我是否关注 ta / 是否互关」由前端并发调 `GET /api/user/follows/states?userIds={userId}` 聚合。
- `GET /api/user/follows/states?userIds=...`：单次上限 50 个 ID（与现有 `GET /api/user/users?ids=` 保持一致），返回每个目标用户的 `following`（我是否关注 ta）和 `followedBy`（ta 是否关注我），前端据此同时渲染「已关注」「互相关注」「回关」状态。
- `GET /api/user/me/following/ids`：按 `created_at DESC, id DESC` 返回当前用户关注的所有 `userId`（最多 200 条）及基础摘要（`userId` / `nickname` / `avatarUrl`），供 `/following` 左栏渲染和右侧「全部关注」拉帖一次拿到，避免反复翻页。
- `POST /api/user/auth/password`：
  1. 校验 `newPassword` 满足与注册一致的密码规则（8~72 字符，复用现有校验常量）；
  2. 校验 `oldPassword` 与 `t_user.password_hash` 匹配，不匹配返回 HTTP 200 + `40207`；
  3. 校验 `newPassword` 不与原密码相同，相同返回 HTTP 200 + `40208`；
  4. **同一事务内**：更新 `t_user.password_hash = BCrypt(newPassword)` + 吊销该用户全部未吊销 `t_refresh_token`（`revoked_at = NOW(3)`）；
  5. **事务提交后**：复用现有 `kick` 逻辑清空 Redis 中该用户全部 `auth:session:{jti}` 与反向索引 `auth:user:{userId}:access`，并在 HTTP 响应中下发 `Max-Age=0` 清除 `kuaikan_refresh` cookie。

### 3.2 `notification-service`

```text
# 现有端点向后兼容扩展（append-only）
GET    /api/notification/unread                             响应追加 follow 字段（total = like + comment + mention + follow + system）
GET    /api/notification/messages?type=&cursor=&limit=      type 新增允许值 FOLLOW
POST   /api/notification/read-all                           无变更（覆盖全部 5 类）
POST   /api/notification/messages/{id}/read                 无变更
GET    /api/notification/stream                             SSE 推送照常覆盖 FOLLOW 类型
```

### 3.3 `content-service`

```text
# 新增 —— 游客可读
GET    /api/content/posts?authorId={id}&cursor=&limit=      扩展现有 GET /posts：支持传 communityId 或 authorId（二选一，不可同时为空）
POST   /api/content/posts/by-authors                        body: { authorIds: string[], cursor?: string, limit?: number }；按作者集合查时间线
POST   /api/content/posts/batch                             body: { ids: string[] }；批量查帖子摘要（供「我的收藏」补齐展示，上限 50）
```

要点：
- **为什么 `by-authors` 和 `batch` 用 `POST` 而非 `GET`**：吸取 P5.1 批量 ID 超 URL 长度上限的教训（200 个 19 位雪花 ID 拼 query string 约 4 KB，极易触发容器/代理 URI 长度限制）；`POST` 放 body 稳妥可控，同时在网关按 `(POST, /api/content/posts/by-authors)` 和 `(POST, /api/content/posts/batch)` 评估放行策略：
  - `by-authors` 仅 `/following` 登录态使用，**不放行游客**（需登录），且 `authorIds` 长度上限 200（空数组直接返回空列表，超过 200 返回 `40010`）。
  - `batch` 仅「我的收藏」登录态使用，**不放行游客**（需登录），`ids` 上限 50；**只返回存在的、未删除（`status = 1`）的帖子摘要**，前端按 `Map<postId, PostSummary>` 映射，缺席的 `postId` 即判定为「该帖子已被删除」。
- `GET /api/content/posts` 扩展 `authorId` 参数：走已有的 `idx_author_created (author_id, created_at, id)`，游标格式与社群帖列表完全一致（`created_at, id`），游客可读，不破坏任何既有 `communityId` 调用方。

### 3.4 `community-service`

```text
# 新增 —— 游客可读
GET    /api/community/users/{userId}/communities?cursor=&limit=   查指定用户已加入的社群（status=1，按 joined_at DESC, id DESC 游标分页）
```

要点：
- 复用 `t_community_member` 已有的 `idx_user_joined (user_id, status, joined_at, id)`，联表本地 `t_community` 返回社群摘要（`id`, `name`, `description`, `memberCount`, `joinedAt`）；不跨库，完全遵守 ADR 0006。

### 3.5 `interaction-service`

```text
# 新增 —— 需登录（仅查本人，不接受 userId 参数，防越权窥探他人私密收藏）
GET    /api/interaction/favorites?cursor=&limit=            返回 { items: [{ postId, createdAt }], nextCursor, hasMore }
```

### 3.6 网关白名单增量（`gateway` `public-patterns`）

严守不变量 12（游客可读端点必须显式声明）：

| Method | 路径模式 | 归属 |
|---|---|---|
| `GET` | `^/api/user/users/[^/]+/profile$` | `user-service` |
| `GET` | `^/api/user/users/[^/]+/following$` | `user-service` |
| `GET` | `^/api/user/users/[^/]+/followers$` | `user-service` |
| `GET` | `^/api/community/users/[^/]+/communities$` | `community-service` |

> 注：`GET /api/content/posts` 已在 P2 放行白名单中，扩展 `authorId` 参数无需新增路由规则。`POST /api/content/posts/by-authors`、`POST /api/content/posts/batch`、`GET /api/interaction/favorites`、`GET /api/user/follows/states`、`GET /api/user/me/following/ids`、`POST/DELETE /api/user/users/{id}/follow`、`POST /api/user/auth/password` **一律需要登录，绝不进白名单**。

---

## 4. 事件契约与 `FOLLOW` 消息规则

### 4.1 Topic 与事件体（`kuaikan-common`）

```java
// Topics.java
public static final String USER_FOLLOWED = "kuaikan_user_followed";
```

```java
// UserFollowed.java（所有 id 一律 String，与 CommentCreated / InteractionChange 一致）
public record UserFollowed(
        String eventId,
        long occurredAt,
        String followerId,
        String followeeId,
        String followerNickname,   // 写入时由 user-service 本地直接快照，消费端无需回调 user-service
        String followerAvatar      // 可空
) {}
```

**刻意把 `followerNickname` / `followerAvatar` 放进事件载荷**：`user-service` 自己就是 `t_user` 的所有者，同进程即可拿到快照，避免 `notification-service` 收到事件后再 HTTP 回调 `user-service` 查头像昵称（减少一次跨服务依赖，且保证消息记录的是「关注那一刻的快照」，符合不变量 9）。

### 4.2 `notification-service` 消费与 24h 冷却去重

- **独立 consumer group**：`kuaikan-notification-follow-consumer`（遵守 P4 §6.1，不与任何既有消费组复用名称）。
- **自抑制**：`followerId.equals(followeeId)` 直接忽略（纵深防御）。
- **24 小时冷却防刷**：落 `t_message` 之前查库：
  ```sql
  SELECT 1 FROM t_message
  WHERE user_id = #{followeeId}
    AND type = 'FOLLOW'
    AND actor_id = #{followerId}
    AND created_at > #{cutoff}
  LIMIT 1
  ```
  其中 `cutoff = NOW() - kuaikan.notification.follow-cooldown`（默认 `PT24H`，放 Nacos/配置可覆盖，便于测试窗口行为）。命中冷却直接跳过落库与 SSE 推送并正常 ACK，不视为失败。
- **为什么冷却查 MySQL 而不是 Redis**：与 P4 未读数放弃 Redis 计数器同一哲学——`notification-service` 的事实全在 MySQL，加一条联合索引即可毫秒级判定，不引入 Redis 依赖，也不存在 Redis 重启丢冷却状态的问题。
- **落库与跳转字段**：
  - `type = 'FOLLOW'`
  - `actor_id = followerId`，`actor_nickname = followerNickname`，`actor_avatar = followerAvatar`
  - `target_type = 'USER'`，`target_id = followerId`（或空，跳转直接使用 `actorId`）
  - `source_event_id = eventId`（沿用 `UNIQUE (user_id, source_event_id)` 兜底 MQ 重投）
  - 事务提交后向 `followeeId` 推 SSE 事件。
- **展示规则**：前端消息抽屉 Tab 顺序为 `点赞 / 评论 / @ / 关注 / 系统`；`FOLLOW` 类型**不走 `foldMessages` 折叠**，每条独立显示「`<昵称>` 关注了你」，点击标已读并跳转 `/u/{actorId}`。

---

## 5. 数据模型与 Flyway 迁移

### 5.1 `user-service`：`V4__create_user_follow.sql`

```sql
CREATE TABLE t_user_follow (
  id           BIGINT UNSIGNED NOT NULL,
  follower_id  BIGINT UNSIGNED NOT NULL COMMENT '关注者',
  followee_id  BIGINT UNSIGNED NOT NULL COMMENT '被关注者',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_follower_followee (follower_id, followee_id),
  KEY idx_follower_created (follower_id, created_at, id),
  KEY idx_followee_created (followee_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户关注关系';
```

**不额外在 `t_user` 存 `following_count` / `follower_count` 列**：
- 遵循 ADR 0010（「计数是派生状态，能算就别存」）；
- 上述两条联合索引覆盖单用户的关注数与粉丝数 `COUNT(*)` 查询（在 1 万用户 / 单人上限 200 规模下为纯内存索引扫描，微秒~毫秒级）；
- 彻底省去双写、并发竞态与对账任务。

### 5.2 `notification-service`：`V4__follow_cooldown_index.sql`

```sql
ALTER TABLE t_message
  ADD KEY idx_follow_cooldown (user_id, type, actor_id, created_at);
```

### 5.3 `interaction-service`：`V3__user_kind_created_index.sql`

```sql
ALTER TABLE t_interaction
  ADD KEY idx_user_kind_created (user_id, kind, target_type, created_at, id);
```

### 5.4 `content-service` 与 `community-service`：**零 DDL**

- `t_post` 在 `V1__create_post.sql` 已建 `KEY idx_author_created (author_id, created_at, id)`；
- `t_community_member` 在 `V1__create_community.sql` 已建 `KEY idx_user_joined (user_id, status, joined_at, id)`。

---

## 6. 关键设计判定点

### 6.1 `/following` 读路径严守 ADR 0005

```text
浏览器（已登录）进入 /following
  ├─ 1. GET  /api/user/me/following/ids              → 左栏已关注人列表（含 nickname/avatarUrl）
  ├─ 2. 选中「全部关注」:
  │     POST /api/content/posts/by-authors { authorIds, cursor, limit }
  │     选中某位作者 A:
  │     GET  /api/content/posts?authorId=A&cursor=&limit=
  └─ 3. 并行映射作者（直接复用步骤 1 的 Map）+ 社群名（复用社区列表缓存）
```

- 后端无任何跨服务同步读调用；
- 若用户尚未关注任何人，步骤 1 返回空数组，前端直接展示空态引导去社群发现作者，不发步骤 2 请求；
- 若游客访问 `/following`，直接展示「登录后查看你关注的人的动态」引导态（带去登录按钮），不触发 401 报错噪音。

### 6.2 修改密码的原子性与全端失效顺序

1. 先改库（`password_hash` + `UPDATE t_refresh_token SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL`）在同一本地事务提交；
2. 再清 Redis 全部 access 白名单键（`auth:session:{jti}` + `auth:user:{userId}:access`）并清当前响应的 `kuaikan_refresh` cookie；
3. **为什么不能颠倒顺序**：若先清 Redis 后改库，改库失败会无端把用户全端踢掉；先提交数据库事务，即使 Redis 瞬时失败，所有 refresh 已吊销且网关在 Redis 不可用时本身 fail-closed，最坏仅剩旧 access 自然过期。
4. 前端收到成功响应后立即调用本地 `clearSession()`（不再发 `/auth/logout` 避免多一次 401）并 `navigate('/login', { replace: true, state: { notice: '密码已修改，请使用新密码重新登录' } })`。

### 6.3 `/me` 改造与 P1 验收的零破坏兼容

现有 `verify-p1.sh` / `e2e:auth` 在打开 `/me` 后直接断言以下 `data-testid` 存在且立即可见：
- `profile`、`profile-nickname`、`btn-edit-profile`、`btn-logout`、`session-list`

因此 `/me` 采用**默认展示核心信息，或 Tab 默认落在「资料与安全」且不隐藏既有节点**的策略：
- **推荐做法**：`/me` 顶部为标题行 +「查看我的主页」链接（`/u/${user.userId}`）；主体采用分段切换或分区布局——为了 100% 不破坏 P1 回归脚本，**「资料」「修改密码」「我的收藏」「登录设备」全部作为 `/me` 页内清晰的 hairline 分区**（或将「我的收藏」与「登录设备」均以可折叠/平铺分区呈现且默认展开），所有 P1 原有 `data-testid` 保持原名且首屏立即可见。

### 6.4 关注上限并发边界

单人关注上限 200 不是强金融约束。在 `POST /users/{id}/follow` 中事务内先查 `COUNT(*)` 再 `INSERT IGNORE`：普通操作精确卡死 200；极端并发下最多多出 1~2 条，不影响 SQL 性能与业务安全，因此**不引入额外用户行锁或分布式锁**，避免过度设计。

### 6.5 社区示例数据（可选顺带）

`deploy/bin/seed-demo.sh` 暂不强绑定关注数据；如需在演示环境看到关注流，可按需在 P5.5.4 之后通过真实接口追加几条关注关系。

---

## 7. 前端信息架构与页面规划

遵循既有视觉规范（1px hairline + 留白、不用卡片、7 档字号、宽屏 1200px / 1000px 居中）：

| 页面 / 触点 | 路由 / 位置 | 核心交互与 `data-testid` 约定 |
|---|---|---|
| **关注按钮组件** | 复用组件 `FollowButton` | 三态：`关注` / `已关注`（hover 显示 `取消关注`）/ `互相关注`；游客点击跳 `/login`；本人隐藏；乐观反馈 + 失效对应 query |
| **消息抽屉** | 顶栏右侧抽屉 | Tab 扩为 5 项：`点赞` / `评论` / `@` / `关注` / `系统`；`FOLLOW` 条目逐条展示，点击标已读并跳转 `/u/{actorId}` |
| **帖子详情 & 评论** | `/c/:name/p/:postId` | 帖子作者头像与昵称、评论作者头像与昵称均可点击跳转 `/u/:userId`；帖子详情作者行右侧显示 `FollowButton`（非本人时） |
| **用户主页** | `/u/:userId` | 头部：头像、昵称、关注数 / 粉丝数、`FollowButton`（本人显示「编辑资料」跳 `/me`）；四个 Tab：`帖子` / `社群` / `关注` / `粉丝`（均支持游标加载更多，游客全量可读） |
| **关注页** | `/following` | 已登录：1200px 双栏——左栏（300px）「全部关注」+ 已关注用户列表（带头像、昵称、可快速进主页），右栏按时间倒序的帖子列表（含社群标签、作者、热度计数，点进 `/c/:name/p/:postId`）；未登录：引导登录空态 |
| **我的** | `/me` | 顶部加「查看我的主页」链接；页内四个 hairline 分区：`资料`（保留全部 P1 `data-testid`）→ `修改密码`（原密码/新密码/确认新密码）→ `我的收藏`（游标加载更多、支持取消收藏、已删帖灰色占位 + 取消收藏）→ `登录设备`（保留 `session-list`） |

---

## 8. 子阶段切分与验收规划

沿用「契约闸门 → 垂直切片 → 分层验收」节奏：

| 子阶段 | 范围 | 汇合验收标准 |
|---|---|---|
| **P5.5.0 契约闸门** | `contract/error-codes.json` 新增 5 码 + Java 枚举 + `npm run gen:contract`；`Topics.USER_FOLLOWED` + `UserFollowed` record；网关白名单 4 条游客只读规则；更新 `roadmap.md` / `CONTEXT.md` / `architecture.md` | `check-contract.mjs` 全绿（26 码一致）；编译检查通过 |
| **P5.5.1 关注关系 + `FOLLOW` 消息** | `user-service`（`V4` 迁移 + 关注写/读/计数/状态/关注 ID 列表 + outbox 发 `UserFollowed`）；`notification-service`（`V4` 索引 + 消费 `FOLLOW` + 24h 冷却 + `unread` 扩 `follow`）；前端消息抽屉扩五类 tab + `FollowButton` | 关注幂等 / 自关注 `40210` / 上限 `40211` / 取关再关注 24h 内只收 1 条 `FOLLOW` 消息 / 抽屉可见并跳转 `/u/{actorId}` |
| **P5.5.2 用户主页 + 关注流** | `content-service`（`GET /posts?authorId=` + `POST /posts/by-authors`）；`community-service`（`GET /users/{id}/communities`）；前端打通帖子/评论作者跳转、帖子详情关注按钮、完整 `/u/:userId` 四 Tab、双栏 `/following` | 游客可浏览 `/u/:userId` 全部四 Tab；`/following` 全部关注与单人筛选均准确、翻页不重不漏；读路径零跨服务调用 |
| **P5.5.3 `/me` 增强（改密 + 我的收藏）** | `user-service`（`POST /auth/password` + 全端 refresh/access 吊销）；`interaction-service`（`V3` 索引 + `GET /favorites`）；`content-service`（`POST /posts/batch`）；前端 `/me` 改密表单 + 我的收藏 + 我的主页入口 | 旧密码错返 200+`40207`；改密后旧 access 与另一端 refresh 立刻失效、新密码可登；收藏列表准确且已删帖可取消收藏；P1 `/me` 断言零回归 |
| **P5.5.4 分层验收** | 编写 `deploy/bin/verify-p55.sh`（L0 契约与静态检查 / L1 基础设施与索引 / L2 后端 HTTP 契约与边界 / L3 Playwright 浏览器全链路 / L4 容错与冷却验证 / L5 P1+P4 关键回归）；实测全绿并回写 `docs/project.md` | `verify-p55.sh` 全绿、工作区干净、线上首页无测试残留 |
