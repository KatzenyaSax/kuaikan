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
  id                   BIGINT UNSIGNED NOT NULL,
  post_id              BIGINT UNSIGNED NOT NULL,
  root_comment_id      BIGINT UNSIGNED NULL     COMMENT '所属一级评论 id；一级评论自身为 NULL',
  reply_to_comment_id  BIGINT UNSIGNED NULL     COMMENT '直接回复的评论 id；一级评论为 NULL',
  reply_to_user_id     BIGINT UNSIGNED NULL     COMMENT '直接回复的人；渲染"回复 @某人"用',
  author_id            BIGINT UNSIGNED NOT NULL COMMENT '作者；来自网关注入的 UserContext',
  body                 VARCHAR(2000) NOT NULL   COMMENT '纯文本，允许换行',
  like_count           INT UNSIGNED NOT NULL DEFAULT 0,
  reply_count          INT UNSIGNED NOT NULL DEFAULT 0,
  status               TINYINT NOT NULL DEFAULT 1 COMMENT '1 正常 / 0 已删除(tombstone) / 2 已隐藏(P7)',
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_post_root_comment (post_id, root_comment_id, created_at, id),
  KEY idx_root_comment_created (root_comment_id, created_at, id)
);
```

#### 为什么叫 `reply_to_comment_id` 而不是 `parent_id`

`parent_id` 描述的是**结构**（树里的父节点），而我们的展示是**两级平铺**，不是树：

```
A（一级）
  B 回复 @A作者
  C 回复 @B作者     ← C 的"父"是 B，但 UI 上和 B 平级
```

叫 `parent_id` 会让人第一反应写递归渲染，而正确做法是按 `root_comment_id` 一次查平。
**名字在诱导错误的实现。** 而 `reply_to_comment_id` 描述的是语义（我回复了哪条评论），
语义不随展示方式变化。

三列连起来读是一句话：「这条评论属于 `root_comment_id` 这个主楼，回复的是
`reply_to_comment_id`，回复给 `reply_to_user_id` 这个人」。

不变量：**`root_comment_id IS NULL` ⇔ `reply_to_comment_id IS NULL`**（一级评论两个都空）。

#### 为什么 `root_comment_id` 和 `reply_to_comment_id` 都要存

它们回答两个不同的问题，正对应列表页的两种查法：

| 字段 | 回答 | 用在 |
|---|---|---|
| `root_comment_id` | 我属于哪条一级评论 | 一级列表（`IS NULL`）、二级列表（`= ?`） |
| `reply_to_comment_id` | 我直接回复的是谁 | 渲染"回复 @某人"、删除时的关联判断 |

只留 `reply_to_comment_id`（纯邻接表）查二级列表要递归；只留 `root_comment_id`
渲染不出回复关系。

#### `reply_to_user_id` 不是缓存，是快照

理论上能通过 `reply_to_comment_id` join 出父评论作者，但那样列表页每行都要 join，
而且语义会错：它记录的是**"我当时回复的是谁"**。张三是被回复者、后来删号了，
这条回复仍然应该显示"回复 @张三"。

#### tombstone 不是一律软删

```
有回复的评论被删    → 软删（否则子回复的 root_comment_id 变孤儿）
没有回复的评论被删  → 物理删（留一行"该评论已删除"的空壳毫无意义）
```

由此得到一条干净的不变量：

> **`status = 0` 的评论，一定有回复。**

于是列表查询**完全不用过滤 status**（tombstone 要显示、正常评论也显示），索引也不必带 status。
（"一律软删"会导致一级列表混进一堆 `status=0 且 reply_count=0` 的空壳，
查询被迫写成 `(status=1 OR reply_count>0)` 这种别扭条件。）

#### `reply_count` 是**后代总数**（偏离 architecture §7 的原文）

architecture 写的是「直接子节点数，非后代总数」。但我们的展示是两级平铺，
用户看到的"展开 N 条回复"里的 N 必须等于展开后出现的条数：

```
A 有直接回复 B、C，B 下面还有 D
直接子节点数 = 2  → 显示"展开 2 条回复"，展开后出现 3 条   ✗
后代总数    = 3  → 显示"展开 3 条回复"，展开后出现 3 条   ✓
```

只有一级评论需要它（二级回复在两级展示里不再有"展开"）。
这也让 `post.comment_count` 自洽：`Σ(一级评论的 reply_count) + 一级评论数 = comment_count`。

architecture 那句话是为嵌套展示写的；我们选了平铺，所以跟着改。

#### 两条索引对应两条查询

| 查询 | SQL 形状 | 索引 |
|---|---|---|
| 一级列表 | `WHERE post_id=? AND root_comment_id IS NULL ORDER BY created_at ASC, id ASC` | `(post_id, root_comment_id, created_at, id)` |
| 二级列表 | `WHERE root_comment_id=? ORDER BY created_at ASC, id ASC` | `(root_comment_id, created_at, id)` |

评论按**时间正序**（老的在上），读起来像对话。游标是 `(created_at, id)` 复合键，向后翻。

关于 status：P3 只有 1/0，列表不过滤。**P7 引入"隐藏"（status=2）时才第一次出现
"必须排除某状态"的需求**，那时要重新评估索引——不为猜的功能预先设计。

#### 权限（P3.1 定稿）

| 操作 | 要求 | 理由 |
|---|---|---|
| 看评论 | 无（游客可读） | 与帖子一致 |
| 发评论 / 回复 | **必须是社群成员**（`41004`） | 与发帖一致；否则"能评论但不能发帖"很怪，且给刷评论留口子。代价是多一次跨服务调用，复用 P2.3 的 `/internal/memberships` |
| 删除评论 | **只能删自己的**（别人删 → `40300`） | 帖主不能删别人评论。版主权限是 P7 的新概念 |
| 点赞 / 收藏 | 登录即可，**不要求成员** | 轻互动；interaction 侧已为校验目标存在调一次 content，再调 community 就是两次跨服务。贴吧里非会员也能点赞 |

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
