# P7 社群权限与治理技术方案

> 状态：已完成并全量验收通过（`deploy/bin/verify-p7.sh` 158 条断言全绿）。
> 架构不变量见 [`architecture.md`](./architecture.md)，版本与运行事实见 [`../project.md`](../project.md)。
> 注：原 P7 的压测、可观测（SkyWalking/Prometheus/Grafana/Loki）、限流与上线运维整体后置至 **P100**。

---

## 1. 目标与边界

### 1.1 目标
将用户侧唯一开放的高等权限——**「社群管理员」**从数据库字段落地为完整的前后端产品闭环：
1. **单一管理员制**：每个社群有且仅有 1 位社群管理员（复用 `t_community.owner_id`），建社群时创建人自动成为管理员；保留 `t_community_member.role` 字段供未来向后兼容扩展。
2. **管理员转让**：管理员可将管理权直接转让给本社群任意一位在社且未被封禁的成员（前端二次确认）；转让后原管理员降为普通成员（解除 `41005` 无法退群的限制），新管理员立即生效。
3. **社群内封禁用户（踢出并禁入）**：管理员可在本社群内封禁用户（仅影响当前社群，不影响登录与其他社群；游客浏览公开内容不受限制）。支持 **1 天 / 7 天 / 30 天 / 永久** + 原因说明 + 随时解封；若对象在社则同步移出成员并 `member_count - 1`，亦支持封禁已退群用户（防发完违规帖退群逃避）；被封禁用户尝试加入、发帖、评论均被明确拦截（`41006`）。
4. **更改社群信息**：社群名（`name`/`name_key`）保持不可改（URL 与消息/搜索永久缓存依赖）；管理员可编辑 **简介（`description`）**、**社群头像外链（`avatar_url`）**、**社群公告（`announcement`）**，头像全站同步生效。
5. **管理员删除本社群内任意帖子与评论**：复用 `content-service` 既有软删端点与行为（删帖照常清 ES、删评照常留占位并扣减计数），作者删自己照旧，非作者时校验是否为该社群管理员后放行；不跨服务写社群历史。
6. **前端社群首页展示管理员**：在 `/c/:name` 社群概览展示当前管理员（头像 + 昵称 + 管理员徽章，可跳 `/u/:ownerId`）、公告、简介、封禁状态提示，以及「社群历史」与「管理社群」入口。
7. **社群历史（编年史 + 历代管理员 + 公开治理记录）**：公开可读，独立子路由 `/c/:name/history`，顶部展示「历代管理员」交接脉络，下方游标分页展示全部历史事件并支持「全部 / 大事记 / 治理记录」筛选；Flyway 迁移自动为存量社群回填「社群创建」记录。

### 1.2 明确不做（本期边界）
- 多管理员 / 协助管理员任免（留待后续按需启用 `t_community_member.role = 1`）
- 社群解散 / 归档、帖子置顶、治理类站内消息推送（`SYSTEM`）
- 管理员删帖 / 删评跨服务写社群历史（保持 `content` 与 `community` 解耦）
- 压测、可观测栈、限流与备份演练（后置至 `P100`）

---

## 2. 契约变更（P7.0 闸门）

### 2.1 新增错误码（26 → 30 码）

统一写入 `contract/error-codes.json`，同步 Java 枚举（`kuaikan-common` `CommunityErrorCode`）与 `ErrorHttpStatus` 映射，生成 `web/src/shared/api/error-codes.gen.ts`：

| 码 | 名称 | HTTP | owner | 默认文案 | 使用场景 |
|---|---|---|---|---|---|
| `41006` | `COMMUNITY_BANNED` | 403 | `community` | 你已被该社群封禁 | 被封禁用户尝试加入、发帖或评论（响应 `message` 可拼接原因与到期说明） |
| `41007` | `NOT_COMMUNITY_ADMIN` | 403 | `community` | 只有社群管理员可以执行此操作 | 非当前管理员调用编辑信息、转让、封禁/解封、查成员/封禁名单 |
| `41008` | `CANNOT_BAN_ADMIN` | 200 | `community` | 不能封禁社群管理员 | 管理员尝试封禁自己 |
| `41009` | `TRANSFER_TARGET_INVALID` | 200 | `community` | 只能将管理员转让给本社群在社成员 | 转让给自己、非成员或已被封禁的用户 |

> 约束：已有 `41005 OWNER_CANNOT_LEAVE` 的文案与语义保持不变，避免破坏 P2 回归断言。

### 2.2 网关白名单变更（`services/gateway/src/main/resources/application.yml`）

在 `kuaikan.auth.public-patterns` 新增 2 条只放行 `GET` 且路径形状钉死的正则：
- `GET ^/api/community/communities/[^/]+/history$`
- `GET ^/api/community/communities/[^/]+/admins/history$`

以下端点**必须认证，绝不进白名单**：
- `GET /api/community/communities/{name}/my-status`
- `PUT /api/community/communities/{name}`
- `POST /api/community/communities/{name}/transfer`
- `GET /api/community/communities/{name}/members`
- `GET /api/community/communities/{name}/bans`
- `POST /api/community/communities/{name}/bans`
- `DELETE /api/community/communities/{name}/bans/{userId}`

---

## 3. 数据模型（`community` schema，Flyway V2）

迁移文件：`services/community-service/src/main/resources/db/migration/V2__community_admin_governance.sql`

### 3.1 `t_community` 追加列（向后兼容）
```sql
ALTER TABLE t_community
  ADD COLUMN avatar_url   VARCHAR(512)  NULL COMMENT '社群头像外链 URL' AFTER description,
  ADD COLUMN announcement VARCHAR(1000) NULL COMMENT '社群公告/规则' AFTER avatar_url;
```

### 3.2 `t_community_ban`（社群封禁表）
独立于 `t_community_member`，支持封禁已退群用户（防退群逃避）且不干扰 `member_count` 与成员复活逻辑：
```sql
CREATE TABLE t_community_ban (
  id            BIGINT UNSIGNED NOT NULL,
  community_id  BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  banned_by     BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(200)    NULL,
  expires_at    DATETIME(3)     NULL COMMENT 'NULL 表示永久封禁',
  status        TINYINT         NOT NULL DEFAULT 1 COMMENT '1 生效中 / 0 已解封',
  banned_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  unbanned_at   DATETIME(3)     NULL,
  unbanned_by   BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_community_user (community_id, user_id),
  KEY idx_community_status_banned (community_id, status, banned_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
- **有效封禁判定**：`status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))`。
- 限时到期后自然失效，允许用户重新加入社群，无需定时任务扫描。

### 3.3 `t_community_history`（社群历史表 + 存量回填）
```sql
CREATE TABLE t_community_history (
  id              BIGINT UNSIGNED NOT NULL,
  community_id    BIGINT UNSIGNED NOT NULL,
  event_type      VARCHAR(32)     NOT NULL COMMENT 'COMMUNITY_CREATED|ADMIN_TRANSFERRED|INFO_UPDATED|MEMBER_BANNED|MEMBER_UNBANNED',
  category        VARCHAR(16)     NOT NULL COMMENT 'MILESTONE|MODERATION',
  operator_id     BIGINT UNSIGNED NOT NULL,
  target_user_id  BIGINT UNSIGNED NULL,
  detail          VARCHAR(500)    NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_community_created (community_id, created_at DESC, id DESC),
  KEY idx_community_cat_created (community_id, category, created_at DESC, id DESC),
  KEY idx_community_event_created (community_id, event_type, created_at ASC, id ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_community_history (id, community_id, event_type, category, operator_id, target_user_id, detail, created_at)
SELECT id, id, 'COMMUNITY_CREATED', 'MILESTONE', owner_id, owner_id, '创建了社群', created_at
FROM t_community
WHERE status = 1;
```

事件分类约定：
| `event_type` | `category` | `operator_id` | `target_user_id` | `detail` 示例 |
|---|---|---|---|---|
| `COMMUNITY_CREATED` | `MILESTONE` | 创建者 | 创建者 | `创建了社群` |
| `ADMIN_TRANSFERRED` | `MILESTONE` | 原管理员 | 新管理员 | `将社群管理员转让` |
| `INFO_UPDATED` | `MILESTONE` | 管理员 | `NULL` | `更新了社群简介、公告` |
| `MEMBER_BANNED` | `MODERATION` | 管理员 | 被封用户 | `封禁 7 天：发布广告` / `永久封禁` |
| `MEMBER_UNBANNED` | `MODERATION` | 管理员 | 被解封用户 | `解除社群封禁` |

---

## 4. 接口契约

### 4.1 `community-service` 对外端点（网关 `/api/community/**`）

| 方法 | 外部路径 | operationId | 鉴权 | 说明 |
|---|---|---|---|---|
| GET | `/api/community/communities` | `listCommunities`（增强） | `@PublicEndpoint` | 列表项追加 `avatarUrl`、`ownerId`、`createdAt` |
| GET | `/api/community/communities/{name}` | `getCommunity`（增强） | `@PublicEndpoint` | 响应追加 `avatarUrl`、`announcement`、`createdAt`（仍纯游客可缓存，无 viewer 字段） |
| GET | `/api/community/mine` | `listMyCommunities`（增强） | 登录 | 列表项追加 `avatarUrl`、`ownerId` |
| GET | `/api/community/users/{userId}/communities` | `listUserCommunities`（增强） | `@PublicEndpoint` | 列表项追加 `avatarUrl`、`ownerId` |
| GET | `/api/community/communities/{name}/my-status` | `getMyCommunityStatus` | 登录 | 返回 `{joined, admin, banned, banReason, bannedUntil}` |
| PUT | `/api/community/communities/{name}` | `updateCommunityInfo` | 登录（管理员） | 修改 `description` / `avatarUrl` / `announcement`；有实际变化写 `INFO_UPDATED` |
| POST | `/api/community/communities/{name}/transfer` | `transferCommunityAdmin` | 登录（管理员） | `{targetUserId}`，直接交接并写 `ADMIN_TRANSFERRED` |
| GET | `/api/community/communities/{name}/members` | `listCommunityMembers` | 登录（管理员） | 游标分页，返回 `{items: [{userId, joinedAt, admin}], nextCursor, hasMore}` |
| GET | `/api/community/communities/{name}/bans` | `listCommunityBans` | 登录（管理员） | 游标分页，返回当前生效封禁 `{items: [{userId, bannedBy, reason, bannedAt, expiresAt}], nextCursor, hasMore}` |
| POST | `/api/community/communities/{name}/bans` | `banCommunityMember` | 登录（管理员） | `{userId, durationDays, reason}`；`durationDays` 仅允许 `null`/`1`/`7`/`30`；在社则踢出并减成员数；写 `MEMBER_BANNED` |
| DELETE | `/api/community/communities/{name}/bans/{userId}` | `unbanCommunityMember` | 登录（管理员） | 幂等解封；实际解除生效封禁时写 `MEMBER_UNBANNED` |
| GET | `/api/community/communities/{name}/history` | `listCommunityHistory` | `@PublicEndpoint` | `?category=all\|milestone\|moderation&cursor=&limit=`，游标分页（跨 category 复用游标返 `40010`） |
| GET | `/api/community/communities/{name}/admins/history` | `listCommunityAdminHistory` | `@PublicEndpoint` | 返回历代管理员脉络 `{items: [{term, userId, startedAt, endedAt, current}]}` |

> 注意：
> - 所有雪花 ID 字段必须标注 `@Schema(type = "string")`，与 Jackson Long→String 全局序列化对齐。
> - `POST /api/community/communities` 建社群时，需同事务插入一条 `COMMUNITY_CREATED` 历史记录。
> - `POST /api/community/communities/{name}/membership` 加入社群时，先查 `t_community_ban` 有效封禁，命中则返回 `41006`。

### 4.2 内部端点演进（向后兼容追加字段）

`GET /internal/memberships?communityId=&userId=` 响应扩展为：
```json
{
  "exists": true,
  "member": true,
  "role": 0,
  "admin": true,
  "banned": false,
  "banReason": null,
  "bannedUntil": null
}
```
- `admin`：`community.ownerId.equals(userId)`
- `banned`：存在 `t_community_ban` 生效封禁记录（此时 `member` 返回 `false`）

### 4.3 `content-service` 权限联动
- **`PostService.create` / `CommentService.create`**：查 `/internal/memberships` 后，先判 `banned == true` → 抛 `41006`（附原因与到期时间），再判 `!member` → 抛 `41004`。
- **`PostService.delete`**：作者删自己免查 community；非作者时查 `/internal/memberships(post.communityId, userId)`，若 `admin == true` 则放行软删（照常写 `PostDeleted` outbox 清 ES），否则抛 `40300`。
- **`CommentService.delete`**：作者删自己免查 community；非作者时取评论所属帖子的 `communityId` 并查 `/internal/memberships`，若 `admin == true` 则放行软删（照常维护 tombstone 与计数），否则抛 `40300`。

---

## 5. 前端设计（延续 P6 Apple 风格）

### 5.1 路由规划
- `/c/:name`（index：`CommunityOverview`）：
  - 展示社群头像（优先 `avatarUrl`，空则首字母）、名称、成员数、**当前管理员**（调用 `useUserSummaries([ownerId])` 拉取头像与昵称 + 「管理员」徽章，点击跳 `/u/:ownerId`）、社群公告（非空时展示）、简介；
  - 操作区：若已登录且被封禁，展示封禁提示条（原因 + 到期时间/永久）并禁用加入/发帖；「社群历史」入口按钮（所有人可见，跳 `/c/:name/history`）；「管理社群」入口按钮（仅当前管理员可见，跳 `/c/:name/manage`）。
- `/c/:name/history`（独立单栏 `max-w-[980px]`，游客可读）：
  - 顶部返回 `/c/:name` 链接 + 社群名标题；
  - **「历代管理员」区块**：按任期从创社首任到现任展示（头像、昵称、任期起止时间、「现任」徽章，点击跳用户主页）；
  - **「社群时间线」区块**：筛选 Segmented/Tab（`全部` / `大事记` / `治理记录`）+ 游标加载更多，批量拉取操作人与目标用户昵称头像。
- `/c/:name/manage`（独立单栏 `max-w-[980px]`，`RequireAuth`，非管理员展示无权限提示与返回链接）：
  - **社群信息编辑**：表单修改简介、头像外链（带实时头像预览）、社群公告，保存后刷新社群详情缓存；
  - **封禁管理**：
    - 生效中的封禁名单（支持一键解封）；
    - 本社群成员列表（游标加载 + 前端过滤，每行可点「封禁」弹出时长 1天/7天/30天/永久 + 原因表单，管理员本人行不展示封禁）；
  - **管理员转让**：选择本社群在社普通成员 + 二次确认弹窗，转让成功后提示并跳转回 `/c/:name`。
- **帖子详情与评论快捷治理（`PostContent` / `CommentSection`）**：
  - 结合 `useMyCommunityStatus(communityName)` 判定当前用户是否为该社群管理员；
  - 当管理员浏览**他人**的帖子或评论时，显示「删除」（二次确认，文案注明管理员删除）与「封禁作者」（弹出同款封禁时长/原因弹窗）快捷入口。
- **全站社群头像同步**：首页社群卡片、社群切换器、用户主页「社群」Tab 均把 `community.avatarUrl` 传入 `<Avatar />`。
- **硬约束**：保留既有全部 `data-testid`，为 P7 新元素补充清晰 `data-testid` 供 L3 e2e 断言。

---

## 6. 分阶段交付与验证计划

| 子阶段 | 范围 | 校验层 |
|---|---|---|
| **P7.0 契约闸门** | `contract/error-codes.json`（26→30）、`kuaikan-common` 枚举与 HTTP 状态、`gateway` 2 条公开正则、前端 `gen:contract` | T0（`check-contract` + typecheck） |
| **P7.1 社群治理后端** | `community-service` V2 迁移（含历史回填）、改信息/转让/成员/封禁/解封/历史/历代管理员/`my-status`/内部 `memberships` 增强，云端构建部署 | T0 + T1（curl 实测） |
| **P7.2 内容权限联动** | `content-service` 封禁拦截发帖与评论、管理员删他人帖与评论，云端构建部署 + OpenAPI 导出与白名单检查 | T0（`check-openapi` + `gen:types`）+ T1 |
| **P7.3 前端全链路** | 社群首页管理员展示与公告/头像、`/c/:name/history`、`/c/:name/manage`、帖子/评论快捷删帖删评与封禁，本地构建 + 发布上线 | T0（typecheck + lint + build） |
| **P7.4 分层验收与收口** | `deploy/bin/verify-p7.sh`（L0~L4）与 `web/e2e/p7-admin.mjs`，提交后跑全量验证，清残留，回写 `docs/project.md` | T3（`verify-p7.sh` 全绿） |
