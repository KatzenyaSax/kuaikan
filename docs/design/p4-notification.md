# P4 消息中心 · 设计

> 上游：[`roadmap.md`](./roadmap.md) P4 行、[`architecture.md`](./architecture.md) §6 §7
> 相关裁决：ADR [0004](./../adr/0004-like-consistency-outbox.md)（本地消息表）、
> ADR [0006](./../adr/0006-schema-per-service.md)（一个库一个账号）、
> ADR [0009](./../adr/0009-author-summary-live-fetch.md)（作者实时拉取）、
> ADR [0010](./../adr/0010-count-consistency.md)（计数一致性）

## 1. 边界

**做**：消费点赞/评论事件落消息快照、四类未读计数、消息列表（游标分页）、全部已读、
SSE 推送、前端消息抽屉、`@` 提及（解析 + 补全）、系统消息的分类位。

**不做**：

| 不做 | 归属 / 理由 |
|---|---|
| 封禁通知（`UserBanned` → SYSTEM） | 推后单独做。`系统` 分类先只有空态 |
| 消息折叠（"X 等 10 人赞了你"） | P4.4 的收尾项，第一版每条一行 |
| 消息可靠投递（断线补发 / ACK） | **SSE 只是提示通道**，真相在 MySQL，见 §6.9 |
| 私信 | 一期明确不做 |
| 通知偏好设置（关掉某类） | 一期明确不做 |
| 消息删除 | 不计划。消息是历史 |
| 未读数用 Redis 计数器 | **有意不做**，见 §6.5 |

### 为什么 P4 大概率不新增错误码

三个读端点（列表 / 未读 / 全部已读）都**没有业务失败路径**：

- 列表：游标非法 → `40000`；空结果 → 空数组，不是错误
- 未读：永远成功
- 全部已读：幂等，没有"已经全读过了"这种失败

唯一可能新增的是"消息不存在"，但 P4 不做单条已读，所以用不上。

**没有新错误码不是偷懒，是这个功能的失败面本来就小。**

## 2. 端点（P4.0 冻结）

```
# 新增 —— notification-service
GET    /api/notification/messages?type=&cursor=&limit=   登录
GET    /api/notification/unread                          登录
POST   /api/notification/read-all                        登录
GET    /api/notification/stream                          登录，SSE

# 新增 —— community-service
GET    /api/community/communities/{name}/members?cursor=&limit=   游客
       → 只返回 [{userId, joinedAt}]，昵称由前端用 /api/user/users?ids= 聚合（ADR 0005）

GET    /internal/members/membership?communityId=&userId=          （已有，@ 解析复用）

# 新增 —— user-service
GET    /internal/users/by-nicknames?names=a,b,c          内部，@ 解析用
       ⚠️ 必须是内部端点：按昵称查用户一旦公开，等于开放全站用户枚举

# 扩字段 —— content-service
GET    /internal/targets   → TargetView 追加 title / excerpt（append-only，不破坏 P3 契约）
```

**网关白名单**：`/api/notification/**` 全部需要登录，**不进白名单**。
`GET /api/community/communities/{name}/members` 是游客可读，要加 `(GET, 路径)` 元组。

## 3. 事件契约

### 新增 topic

```java
// Topics.java
public static final String COMMENT_CREATED = "kuaikan_comment_created";
```

### 新增 record

```java
public record CommentCreated(
        String eventId,
        long occurredAt,
        String commentId,
        String postId,
        String communityId,
        String postAuthorId,        // 帖子作者，收 COMMENT
        String replyToUserId,       // 被回复者，收 COMMENT；为空表示顶层评论
        List<String> mentionUserIds,// @ 到的人，收 MENTION
        String excerpt               // 评论正文前 N 字，直接进快照，避免消费时再查
) {}
```

两个刻意的设计：

- **`excerpt` 进载荷**，不让消费者回查评论正文。正文可能被编辑或删除，而消息要的是"当时说了什么"。
- **id 一律 String**，理由同 `InteractionChange`（web 层与 MQ 层用的 ObjectMapper 不是同一个，Long 序列化结果不同）。

### `TargetView` 扩字段

```java
public record TargetView(
        boolean exists, Long ownerId,
        String title,     // 帖子标题 / 评论正文摘要
        String excerpt    // 追加，P3 的两个字段不动
) {}
```

追加字段符合不变量 13（只允许追加可选字段）。

## 4. 数据模型

### 4.1 `t_message`（notification schema）

```sql
CREATE TABLE t_message (
  id               BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL COMMENT '接收人',
  type             VARCHAR(16) NOT NULL COMMENT 'LIKE / COMMENT / MENTION / SYSTEM',
  source_event_id  CHAR(36)    NOT NULL COMMENT '来源事件，幂等键',
  actor_id         BIGINT UNSIGNED NULL COMMENT '动作发起人；SYSTEM 为空',
  actor_nickname   VARCHAR(64) NULL COMMENT '快照，非实时',
  actor_avatar     VARCHAR(512) NULL,
  target_type      VARCHAR(16) NULL COMMENT 'POST / COMMENT',
  target_id        BIGINT UNSIGNED NULL,
  target_title     VARCHAR(255) NULL COMMENT '快照：帖子标题',
  excerpt          VARCHAR(255) NULL COMMENT '快照：正文摘录',
  read_at          DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_event (user_id, source_event_id),
  KEY idx_list   (user_id, type, created_at, id),
  KEY idx_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 为什么是 `UNIQUE (user_id, source_event_id)` 两列，不是加 `type`

因为**合并规则保证同一个接收人一次事件只收到一条消息**（§6.4）。
三列会把"我回复了 A，同时正文里 @ 了 A"变成两条消息，而那是同一次动作。

两列还有个副作用是好的：它把"一条事件对一个人只产生一条消息"从**约定**升级成**数据库约束**。

#### 为什么不用 `t_consume_log`

架构 §6 的幂等优先级是「唯一索引 > 去重表 > 对账」。notification 能走**第一档**，因为去重键和被保护的数据在**同一行**：

```sql
INSERT ... ON DUPLICATE KEY UPDATE id = id   -- 或者 INSERT IGNORE，看 affectedRows
```

一次写入，天然原子。content 走不了这档，因为它的去重键要保护的是 `t_post.like_count`（另一行）。

#### 快照列为什么不 set null on update

消息是**历史记录**，不是当前状态。对方改昵称、改头像、删帖子，旧消息都保持原样。
这与 ADR 0009（帖子作者实时拉取）方向相反，是**有意的**：不变量 9 已经写明"快照原则只适用于 notification 的消息"。

### 4.2 `t_outbox`（content schema，P4.0 新建）

结构与 interaction 的完全一致。这正是要抽公共模块的原因——不是"优雅",是**这份代码的正确性全靠细节**（eventId 必须与 outbox 同事务生成、1s 轮询、20 次指数退避后放弃）。

抽成 `kuaikan-common-outbox`，interaction 改为依赖它，content 接入。

## 5. 五条链路

### 链路 1：点赞

```
A 点赞 P（作者 B）
  → POST /api/interaction/likes
  → interaction:
      ├─ GET content/internal/targets?type=post&id=P → ownerId=B
      ├─ INSERT IGNORE t_interaction     affectedRows=0 → 不产生事件，成功返回
      └─ affectedRows=1 → 同事务写 t_outbox
  → OutboxRelay → MQ kuaikan_interaction_changed
  → ┌ content  （group: kuaikan-content-interaction-consumer）     → like_count += 1
    └ notification（group: kuaikan-notification-interaction-consumer）
          → 判定链（§6.1~6.3）→ 拉快照 → INSERT t_message
          → 事务提交后 SSE 推给 B
```

### 链路 2：评论

```
A 在 B 的帖子下评论，正文含 "@C"
  → POST /api/content/posts/{id}/comments
  → content（一个本地事务包住全部）：
      ├─ 校验成员（已有，调 community /internal/members/membership）
      ├─ 解析 @昵称 → mentionUserIds   （尽力而为，失败不影响评论）
      ├─ INSERT t_comment
      ├─ UPDATE t_post SET comment_count += 1
      └─ INSERT t_outbox(topic=kuaikan_comment_created)
  → relay → MQ
  → notification:
      ├─ 接收人 = {postAuthorId: COMMENT} ∪ {replyToUserId: COMMENT} ∪ {mentionUserIds: MENTION}
      ├─ 去掉 actorId 自己
      ├─ 合并：同一 receiver 只留一条，COMMENT 优先于 MENTION
      └─ 同一事务批量 INSERT，uk_user_event 兜底重投
```

### 链路 3：读

```sql
-- 未读：一条 GROUP BY，不是四次 count
SELECT type, COUNT(*) FROM t_message
WHERE user_id = ? AND read_at IS NULL GROUP BY type;

-- 列表：游标 (created_at, id)，按 type 过滤
-- 全部已读：
UPDATE t_message SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL;
```

### 链路 4：`@` 解析（content 内，写评论时）

> **P4.1 落地时的两处修正**：
> 1. 解析结果**落库**到 `t_comment.mentions`（JSON，元素 `{id, nickname}`），
>    不只放进事件。原因：读评论的人需要知道哪几个 @ 可点，不落库就得让每个读者重解析，
>    还会因后来的改名/退社得出不同结论。
> 2. 解析从 `@Transactional` 里移到事务外（`TransactionTemplate` 只包写入段）。
>    否则数据库连接会横跨 1+N 次远程调用。详见 `docs/project.md` 的 P4.1 一节。

```
正文正则提取 @昵称 候选（通常 1~3 个）
  → user/internal/users/by-nicknames?names=a,b,c → [(id, nickname)]
  → 对每个命中：community/internal/members/membership?communityId=&userId=  （复用已有端点）
  → 得到 mentionUserIds
```

**全部失败则降级**：记 WARN，`mentionUserIds` 置空，**评论照常成功**。

理由同 ADR 0009：**评论能不能发出去，比 @ 准不准重要得多。** 让一条 @ 解析挂在写路径上，等于把评论的可用性绑在 user 与 community 的健康度上。

### 链路 5：SSE

```
登录后 → fetch('/api/notification/stream', {headers: {Authorization}})
  → gateway 验 JWT（只在建立时验这一次）
  → notification 注册到 Map<userId, Set<SseEmitter>>
  → 每 15s 心跳
  → 记住 token exp，到点发 event: expired → 前端 refresh 后重连
  → 断开重连：不补发，前端重新拉 unread + 第一页
```

用 `fetch` + `ReadableStream` 而不是 `EventSource`：后者不能设 header，token 只能进 query string，会落进 nginx access_log、浏览器历史、Referer。

## 6. 判定点（全部已定）

### 6.1 consumer group 名字必须不同 🔴

RocketMQ 里 **topic 决定"哪些消息"，group 决定"我是谁"**。

| 两个服务 | 结果 |
|---|---|
| 不同 group 订阅同一 topic | 各自收全量 ✅ |
| **同一 group** | 负载均衡，各拿一半，**不报错** ❌ |

content 已占用 `kuaikan-content-interaction-consumer`。notification 必须用全新的名字。

这是 P4 最容易踩、最难查的坑：现象是"有时候有有时候没有"，而两边日志都正常。

### 6.2 快照拉取失败要分类 🔴

| 情况 | 判据 | 动作 |
|---|---|---|
| 用户/内容已删除 | 空数组 / `exists=false` | **不重试**，落"已注销用户"或跳过 |
| user/content 暂时不可用 | 连接失败 / 5xx | **重试**（MQ 重投） |

不分类的话，一个被删的用户会让这条事件**永远重投**，堵住整个消费组。

### 6.3 判定顺序：先便宜的后贵的

| 顺序 | 判断 | 动作 |
|---|---|---|
| 1 | `kind == FAVORITE` | 跳过（收藏是私密行为） |
| 2 | `change == REMOVED` | 跳过（取消不是新消息） |
| 3 | `actorId == targetOwnerId` | 跳过（自赞） |
| 4 | 以上都过 | 拉快照 + 落库 |

前三步是纯内存判断，第 4 步要跨两个服务。**顺序错了就是白花两次网络调用。**

### 6.4 合并规则：一个接收人一次事件只一条

```
接收人集合，按优先级去重：COMMENT > MENTION
```

"回复了你，同时正文里 @ 了你"是同一次动作，不该产生两条消息。

### 6.5 未读数用 MySQL，不用 Redis 计数器

架构 §7 原文写的是 Redis `unread:{userId}` 四类。**P4 有意偏离**，理由：

Redis 方案下「全部已读」与并发新消息有真 bug：

```
1. 用户点全部已读 → 后端 SET unread:like = 0
2. 同时第 6 条消息到达 → INCR unread:like
   取决于时序：INCR 在 SET 之前 → 计数被抹掉，消息还在但红点消失（吞消息）
```

MySQL 为准的话这个竞态不存在：`UPDATE ... WHERE read_at IS NULL` 要么把第 6 条也标已读（一致），要么它落在 UPDATE 之后保持未读（一致）。

代价是一条 `GROUP BY`。按 `idx_unread` 索引，亚毫秒。

**这就是 ADR 0010 的同一套哲学：计数是派生状态，能算就别存。** Redis 那套"允许漂移 + 每日对账"是为写多读多的点赞数付的代价，未读数不该付。

**推论：P4 不需要对账任务。** 未读派生自消息本身，消息是一次性事实记录，不会漂移。

### 6.6 `@` 重名歧义：取 userId 最小，并写进文档

昵称**没有唯一约束**。规则：

- 前端补全只在**本社群成员**里选（体验层）
- 后端解析也校验**本社群成员**（规则层，前端限制可绕过）
- 重名时取 `userId` 最小的那个
- **歧义不隐藏**，写在本节

### 6.7 `@` 补全的候选来源

```
GET /api/community/communities/{name}/members?limit=50&cursor=
  → [{userId, joinedAt}]
前端：/api/user/users?ids=（≤100 一批）拿昵称 → 客户端按 q 过滤
```

**community 只返回 userId，不返回昵称** —— 保持不变量 2（读路径禁止跨服务同步调用），昵称聚合交给前端（ADR 0005 的模式，与帖子列表完全一致）。

⚠️ 已知限制：**只拉前 N 个成员**（默认 50，按加入时间倒序）。大社群的早期成员不会出现在补全里。P7 再做服务端昵称搜索。

### 6.8 批量插入要么全成要么全败

一条评论事件可能产生多条消息。放一个事务里，失败全部重投——重投时已成功的部分被 `uk_user_event` 自动跳过。

### 6.9 SSE 是提示通道，不是投递通道

消息的真相在 MySQL。SSE 只负责让红点及时亮。

**断线期间的消息不补发**，重连后重新拉 unread + 第一页即可。

不这么定位的话就会去做 `Last-Event-ID` 补发、ACK、重投——那是在重新实现消息队列，而消息本来就已经可靠地存好了。

### 6.10 SSE push 必须在事务提交之后

在事务里推，一旦回滚就是"红点亮了但消息不存在"。

用 `TransactionSynchronizationManager.registerSynchronization` 的 `afterCommit`，不要图省事直接调用。

### 6.11 消息不因目标删除而删除

删评论/删帖子后已发出的消息保留（它是历史）。点进去看到 tombstone 或已删除页。不做级联删除，不做预检查。

### 6.12 `/internal/targets` 是单条查询

`?type=&id=` 一次一个。批量消费 20 条事件就是 20 次调用。

**P4 接受**（量小），记一笔：以后加批量版本。

## 7. 阶段拆分

| 切片 | 内容 | 完成标志 |
|---|---|---|
| **P4.0** | 抽 `kuaikan-common-outbox`；interaction 改依赖；content 接入并发 `CommentCreated` | 评论后 MQ 有消息；content 停机重启事件不丢 |
| **P4.1** | `CommentCreated` 契约；`TargetView` 扩字段；`@` 解析；community 成员端点；user 昵称端点 | 评论含 `@某某`，事件里 `mentionUserIds` 正确 |
| **P4.2** | `t_message`；两个消费者；快照拼装；`uk_user_event` 幂等 | 赞一下，5 秒内库里出一条消息；自赞/收藏/取消不产生 |
| **P4.3** | 未读/列表/全部已读；SSE；前端抽屉接真数据 + 红点 | 别人赞我，红点 5 秒内亮 |
| **P4.4** | 折叠展示；`verify-p4.sh`；`deploy/bin/init-topics.sh` 加新 topic | 验收全绿 |

**每个切片独立可验收**，不要求前一个切片全部完成才能测后一个。

## 8. 验收（`verify-p4.sh`）

约 45 条断言，按层分。

### L1 契约（秒级）

- `Topics.COMMENT_CREATED` 值为 `kuaikan_comment_created`（RocketMQ 不允许点号）
- `CommentCreated` 的 id 字段全是 String
- `TargetView` 的新字段在 OpenAPI 里可见，且 P3 的两个字段没变
- 新增端点全部出现在 openapi 里，operationId 无重复

### L2 写入与幂等

- 别人赞我的帖子 → `t_message` 5 秒内出现一条 `LIKE`
- **我自己赞自己 → 不产生消息**
- **别人收藏我的帖子 → 不产生消息**（最易写错的一条）
- 取消赞 → 不产生新消息
- 赞 → 取消 → 再赞 → 消息条数符合预期（**两条**，因为那是两次事实；折叠在展示层解决）
- 同一事件重复投递（手工重放 outbox） → 消息条数不变
- 评论我的帖子 → 一条 `COMMENT`，接收人是帖子作者
- 回复我的评论 → 一条 `COMMENT`，接收人是被回复者
- 回复我并同时 @ 我 → **仍然一条**，类型是 `COMMENT`
- 评论里 @ 一个非本社群成员 → **不产生 MENTION**
- 评论里 @ 本社群成员 → 产生 `MENTION`

### L3 未读与竞态（核心）

- 初始未读 = 消息条数
- 全部已读后未读归零
- **全部已读的瞬间有新消息到达 → 未读数不为 0**（不吞消息）
- 全部已读重复调用 → 幂等，返回成功
- 未读按 type 分四类返回
- 游标翻页不重不漏

### L4 可靠性与降级

- content 停机时评论 → 恢复后事件仍然发出（outbox 的价值）
- user-service 不可用时点赞 → 消息写入重试（事件不丢）
- 被删除用户产生的事件 → 消费不卡住（判为不可重试）
- `t_outbox` 里 status=0 的行在 relay 恢复后全部变为 1

### L5 SSE

- 建立连接 → 收到 `connected` 事件
- 15s 内收到心跳
- 别人赞我 → 连接上收到 `message` 事件
- 连接建立后 token 过期 → 收到 `expired` 事件
- **事务回滚时不推送**（构造一个失败场景，确认没推送）

### L6 回归

- `verify.sh` / `verify-p05.sh` / `verify-p1.sh` / `verify-p2.sh` / `verify-p3.sh` 全绿
- 首页没有任何测试残留（历史上出过 e2e 孤儿帖挂在首页）
