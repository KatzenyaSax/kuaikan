# P3 评论与互动 · 设计

> 上游：[`roadmap.md`](./roadmap.md) P3 行、[`architecture.md`](./architecture.md) §6 §7
> 相关裁决：ADR [0009](./../adr/0009-author-summary-live-fetch.md)（作者信息实时拉取）、
> ADR [0010](./../adr/0010-count-consistency.md)（计数一致性）

## 1. 边界

**做**：评论帖子、回复评论（存储任意深度/展示两级）、删除自己的评论（tombstone）、
点赞与收藏（帖子 + 评论）、计数投影、outbox + MQ + 消费幂等、对账任务。

**不做**：

| 不做 | 归属 |
|---|---|
| 消息通知（"有人赞了你"） | P4（但事件载荷现在就把 `targetOwnerId` 带上，否则以后要换 topic） |
| 评论按热度排序 | P5（P3 只按时间正序） |
| 删除别人的评论 / 版主权限 | P7 |
| 编辑评论 / 编辑历史 | 不计划 |
| 楼层号（1 楼 2 楼） | 不计划。删除 + 分页下楼层号必然错乱，Discourse 也没有它 |
| @ 提及 | P4 起再说。它要解析昵称→用户 id，而现在没人消费 |
| 举报与审核 | 一期明确不做 |
| 图片评论 | 一期明确不做 |
| Redis 计数 | P5 |

## 2. 端点（P3.0 冻结）

```
GET    /api/content/posts/{postId}/comments?cursor=&limit=       游客
POST   /api/content/posts/{postId}/comments                      登录
GET    /api/content/comments/{commentId}/replies?cursor=&limit=  游客
DELETE /api/content/comments/{commentId}                         登录（仅作者）
POST   /api/interaction/likes                                    登录（toggle）
POST   /api/interaction/favorites                                登录（toggle）
GET    /api/interaction/states?targets=post:1,comment:2          登录
```

内部接口：

```
GET /internal/targets?type=post|comment&id=                      interaction → content
    → { exists, ownerId }   点赞前校验目标存在，并拿到 targetOwnerId
```

**游客可见面**（网关放行，`check-openapi` 守）：

```
GET ^/api/content/posts/[0-9]+/comments$
GET ^/api/content/comments/[0-9]+/replies$
```

`states` 是登录态接口（回答"**我**赞过没"），游客前端不调它。

## 3. 事件契约

见 `kuaikan-common` 的 `InteractionChange` 与 `Topics.INTERACTION_CHANGED`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `eventId` | String(UUID) | 幂等唯一键。**写 outbox 时生成，重投时不变** |
| `occurredAt` | long | epoch 毫秒 |
| `change` | ADDED / REMOVED | |
| `kind` | LIKE / FAVORITE | |
| `actorId` | String | 操作者 |
| `targetType` | POST / COMMENT | |
| `targetId` | String | |
| `targetOwnerId` | String | 目标作者。content 用不到，P4 的通知需要 |

三条硬规则：

1. **id 一律用 String。** web 层的 ObjectMapper 有 Long→String 配置，MQ 序列化用的是
   RocketMQ 自带的，不受那个配置影响；同一个 Long 在两处序列化成不同类型，
   而消费端反序列化失败是**运行时**才暴露的。
2. **事件不可变。** 不兼容变更 = 新 topic，新旧并行。不加 `v` 字段（没有机制去用它）。
3. **评论事件 P3 不发。** 评论数在本地事务里就算完了，P3 没有任何消费者。
   等 P4 真正需要（通知）、P6 需要（索引）时再冻结那个契约。

## 4. 数据模型

### 4.1 `t_comment`（content schema，P3.1）

```sql
CREATE TABLE t_comment (
  id                BIGINT UNSIGNED NOT NULL,
  post_id           BIGINT UNSIGNED NOT NULL,
  root_id           BIGINT UNSIGNED NULL     COMMENT '一级评论 id；一级评论自身为 NULL',
  parent_id         BIGINT UNSIGNED NULL     COMMENT '直接父评论 id；一级评论为 NULL',
  author_id         BIGINT UNSIGNED NOT NULL,
  reply_to_user_id  BIGINT UNSIGNED NULL     COMMENT '回复给谁；二级回复的第二级需要它渲染"回复 @某人"',
  body              VARCHAR(2000)  NOT NULL,
  like_count        INT UNSIGNED NOT NULL DEFAULT 0,
  reply_count       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '直接子节点数，不是后代总数',
  status            TINYINT NOT NULL DEFAULT 1 COMMENT '1 正常 / 0 已删除（tombstone 保留行）/ 2 已隐藏(P7)',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_post_created (post_id, root_id, status, created_at, id),
  KEY idx_root_created (root_id, status, created_at, id)
);
```

**`root_id` + `parent_id` 两个都要**：
- `parent_id` 记录直接父节点（渲染"回复 @某人"）
- `root_id` 记录所属的一级评论（**一级列表只查 `root_id IS NULL`**，二级列表只查
  `root_id = ?`）。只靠 `parent_id` 查二级列表就得递归，而展示只要两级。

**tombstone**：删除不是物理删，是 `status = 0` 且 `body` 清空（避免已删内容还能被读到）。
一级评论被删且**有回复**时，行要保留（否则二级回复变孤儿），展示成"该评论已删除"。
没回复的评论可以真删——但为了逻辑统一，P3 一律软删，物理清理交给 P7 的归档任务。

### 4.2 `t_interaction`（interaction schema，P3.2）

```sql
CREATE TABLE t_interaction (
  id            BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  kind          TINYINT NOT NULL  COMMENT '1 点赞 / 2 收藏',
  target_type   TINYINT NOT NULL  COMMENT '1 帖子 / 2 评论',
  target_id     BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 幂等第一层：重复点赞在写入侧就被唯一键挡掉，不产生第二个事件
  UNIQUE KEY uk_user_kind_target (user_id, kind, target_type, target_id),
  KEY idx_target (target_type, target_id, created_at, id)
);
```

**一张表加 `kind`，不是两张表。** 结构与语义完全一样，只差一个枚举值；
两张表意味着两条代码路径、两份断言，而收益是零。
理由同 P3 拆解里说的"按机制拆而不是按功能拆"。

### 4.3 `t_outbox`（interaction schema，P3.2）

```sql
CREATE TABLE t_outbox (
  id             BIGINT UNSIGNED NOT NULL,
  event_id       VARCHAR(36) NOT NULL,
  topic          VARCHAR(64) NOT NULL,
  payload        TEXT NOT NULL,
  status         TINYINT NOT NULL DEFAULT 0 COMMENT '0 待投递 / 1 已投递 / 2 已放弃',
  retry_count    INT NOT NULL DEFAULT 0,
  next_retry_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_id (event_id)
);
```

### 4.4 `t_consume_log`（content schema，P3.2）

```sql
CREATE TABLE t_consume_log (
  id          BIGINT UNSIGNED NOT NULL,
  event_id    VARCHAR(36) NOT NULL,
  consumer    VARCHAR(64) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 幂等第二层
  UNIQUE KEY uk_event_consumer (event_id, consumer)
);
```

### 4.5 对 `t_post` 的 ALTER（content，P3.1 建评论时一起做）

P2 刻意没有预建计数列。现在有了写入者，一次补齐：

```sql
ALTER TABLE t_post
  ADD COLUMN like_count     INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN favorite_count INT UNSIGNED NOT NULL DEFAULT 0;
```

`comment_count` 也在这一刀加（P2 时同样没建）。MySQL 8 的 `ALGORITHM=INSTANT` 对加列是
元数据操作，百万行也是秒级——当初推迟的代价确实是零。

## 5. 阶段拆分

| 子阶段 | 交付 | **唯一的新概念** |
|---|---|---|
| **P3.0 契约闸门** | 事件契约、ADR 0010、错误码、端点与放行规则、`verify-p3.sh` 骨架 | 无业务代码 |
| **P3.1 评论** | `t_comment`、发/读/两级/删除、`comment_count`/`reply_count`、前端评论区 | **树形数据 + 强一致计数** |
| **P3.2 点赞收藏** | `t_interaction`、`t_outbox`、`t_consume_log`、MQ 生产与消费、计数投影、**对账**、前端按钮 | **最终一致计数 + 异步管道 + 对账** |
| **P3.3 验收收口** | L3/L4 断言、清数据、文档 | — |

**对账不是独立一刀**：P3.2 结束时如果没有对账，一次丢事件就导致计数永久错，
那是"已知会错"的状态，不是"功能子集"。对账是 P3.2 完成定义的一部分。

## 6. 验收

| 层 | 内容 |
|---|---|
| L1 | 契约三方一致（21 码）+ OpenAPI 与放行规则一致 + 脚本检查 + 类型无漂移 |
| L2 | 评论 CRUD、两级展示、tombstone、点赞 toggle、`states` 批量、**5 秒内计数变化**（轮询） |
| L3 | 浏览器：发评论、展开回复、点赞按钮状态、删除后显示"已删除"但回复仍在 |
| L4 | ① kill content-service → 点赞成功但计数不变 → 重启 → 对账修回<br>② 手动重投同一事件 → 计数只 +1<br>③ 把 `like_count` 改错 → 跑对账 → 修回 |
| L5 | P0 + P0.5 + P1 + P2 全回归 |

L4 的第 ② 条是 P3 最值钱的断言：**MQ 是 at-least-once，重复投递是必然事件**。
