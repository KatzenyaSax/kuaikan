# P5 排行 · 设计

> 上游：[`roadmap.md`](./roadmap.md) P5 行、[`architecture.md`](./architecture.md) §7 §11
> 相关裁决：ADR [0001](./../adr/0001-microservices-as-showcase-not-scale.md)（微服务是展示而非规模需求）

## 1. 边界

**做**：帖子的日榜 / 周榜（Top 50，不分页）、热度公式（多因子 + 时间衰减）、
浏览量 / 分享量两个新计数、评论按热度排序（可选，默认仍是时间序）。

**不做**：

| 不做 | 理由 |
|---|---|
| 热度**增速**（二阶导数） | 小基数下会爆炸（1 赞 → 2 赞 = +100%）；需要两个时间点的数据；**无法向用户解释**。`log2` 的边际递减已经够了 |
| 榜单历史名次 / 趋势箭头 | 要额外存历史快照，且没人会看 |
| 深度分页 / 搜索榜内内容 | Top 50 不分页，架构已定 |
| 浏览量 IP 去重 | 口径已定为"不要求精确"。去重会让实现复杂度翻倍，收益是防刷——那是 P7 的事 |
| 榜单按社群过滤 | 一期只做全站榜。社群榜需要另一套 ZSet，等有人要再说 |

## 2. 热度公式

```
recent   = w_comment·log2(1+C_win) + w_fav·log2(1+F_win) + w_like·log2(1+L_win)
longtail = w_share·log2(1+S_total) + w_view·log2(1+V_total)

raw      = recent + LONGTAIL_FACTOR · longtail
score    = raw · 0.5 ^ (hours_since_last_interaction / H)

H(日榜) = 24h      H(周榜) = 168h
LONGTAIL_FACTOR = 0.3
```

| 符号 | 含义 | 来源 |
|---|---|---|
| `C_win` | 窗口内新增评论数 | content 本地 `t_comment.created_at` |
| `F_win` | 窗口内新增收藏数 | interaction `t_interaction.created_at`（kind=2） |
| `L_win` | 窗口内新增点赞数 | interaction `t_interaction.created_at`（kind=1） |
| `S_total` | 累计分享数 | `t_post.share_count` |
| `V_total` | 累计浏览数 | `t_post.view_count` |
| `last_interaction_at` | 最后一次互动时间 | `t_post.last_interaction_at` |

默认权重：`{ comment: 5, favorite: 4, share: 3, like: 2, view: 0.5 }`，
放 Nacos（`kuaikan.rank.weights.*`），可热更新。

### 2.1 为什么每个因子取 `log2`

各因子量级根本不可比：一篇帖可能 800 浏览、3 条评论。任何让浏览量有意义的
**线性**权重都会让浏览量主导排序。

log 带来三件事：

1. **量级归一** —— 800 浏览 ≈ 9.6，20 赞 ≈ 4.4，可以放在同一尺度上比
2. **边际递减** —— 第 100 个赞比第 2 个赞"便宜"，符合直觉，也天然抑制刷量
3. **加新因子不用重新平衡** —— 以后想加"被引用""转发到站外"，权重填个数就行

### 2.2 为什么强信号用增量、弱信号用累计

纯累计 + 衰减有个真问题：

| 帖子 | 数据 | raw | 衰减 | score |
|---|---|---|---|---|
| A | 30 天前发，累计 200 赞 / 50 评论，**昨天被赞了一次** | 54.7 | 0.5 | **27.3** |
| B | 今天发，3 赞 / 1 评论 | 13.4 | 1.0 | **13.4** |

A 因为昨天那一个赞压过今天的新爆款。**这不合理**——昨天只新增 1 个赞。

所以强信号（评论 / 赞 / 收藏）走**窗口内增量**，它们能在一秒内发生，
反映"正在发生什么"。

而浏览量和分享量**没有按天存**。要算增量就得加按天表 + 每日清零任务，
那是在给自己造对账问题。所以它们走累计，并额外乘 `0.3`——
**诚实标注：它们是长尾信号，不是主力**。

> 这是有意的不同构。公式里两种因子的地位不同，文档写清楚比假装统一好。

### 2.3 为什么衰减基准是 `last_interaction_at`

- 用 `created_at` 衰减 → 老帖永无翻身，与"历史数据一样重要"矛盾
- 用 `last_interaction_at` 衰减 → 每次互动把帖子"重新点燃"，
  **这本身就是活跃度的近似，不需要真算增速**

副作用：持续被零星点赞的老帖，衰减会被不断重置。这是**可接受的**——
它确实"最近还有人看"。要压住它，靠的是 `recent` 里"增量"这个口径：
零星互动产生的增量很小。

## 3. 时间窗口：由衰减常数推导，不是拍脑袋

完全没有边界会变成全表扫描。正确形态是**让衰减自己给出截止**：

```
半衰期 H = 24h，帖子 30 天前发
衰减 = 0.5^(720/24) = 0.5^30 ≈ 9.3e-10
```

这种帖子就算 `raw = 10000`，score 也只有 0.0000093，**不可能进 Top 50**。

所以候选查询写成：

```sql
WHERE status = 1
  AND (created_at >= NOW() - INTERVAL (CANDIDATE_SPAN * H) HOUR
       OR last_interaction_at >= NOW() - INTERVAL (CANDIDATE_SPAN * H) HOUR)
```

`CANDIDATE_SPAN` 取到"衰减后贡献 < 1"为止，默认 **10**（日榜 10 天、周榜 70 天）。
**窗口宽度随 H 自动变化**——调 H 的时候窗口跟着变，不会出现"改了半衰期但窗口没跟上"。

### 3.1 OR 会破坏索引，所以用 UNION

`WHERE a >= x OR b >= y` 在 MySQL 里通常退化成全表扫描。写成两条各自走索引的查询再合并：

```sql
SELECT id FROM t_post WHERE status=1 AND created_at >= ?           -- 走 idx_community_created? 不，需要独立索引
UNION
SELECT id FROM t_post WHERE status=1 AND last_interaction_at >= ?  -- 走 idx_status_last_interaction
```

所以 `t_post` 要加两列索引：

```sql
KEY idx_status_created (status, created_at, id)
KEY idx_status_last_interaction (status, last_interaction_at, id)
```

## 4. 计算时机：定时全量重算，不做显式候选集

每 5 分钟一次，拉候选 → 算分 → 写新版本 → 原子切换。

### 4.1 为什么不做"有交互就加入候选集"

那个方案方向对，但**显式候选集是过度设计**：

| | 显式候选集（Redis Set / 表） | 查询条件（SQL WHERE） |
|---|---|---|
| 收敛 | 要处理过期清理 | 索引直接过滤 |
| 丢失后 | **无法自愈**，要重建逻辑 | 天然自愈（查询本身就是重建） |
| 一致性 | 加入/移除与事实可能不一致 | 永远与事实一致 |

**rank 是纯投影，最大的性质就是"可以随时全量重建"。** 显式候选集把这个性质弄丢了。

而且"有交互就重算"有写放大问题：热点帖每来一个赞就算一次、写一次 ZSet。
**定时 5 分钟的实时性对热榜完全够。**

> 如果以后数据大到 SQL 查询本身变慢，可以把候选集物化成一张表当缓存。
> 那是优化，不是设计。

## 5. 读写路径

### 5.1 重建（每 5 分钟）

```
① 向 content 要候选帖：GET /internal/rank/candidates?since=&cursor=
     → [{postId, title, communityName, authorId, like_count, ..., viewCount, shareCount,
         lastInteractionAt, recentCommentCount, createdAt}]
   ⚠️ 分页拉，不一次全量

② 向 interaction 要窗口内增量：POST /internal/counts/since
     {targetType:"post", since:<epoch>, targetIds:[...]} → [{targetId, likeDelta, favoriteDelta}]
   ⚠️ 按批（≤200 个 id），见 §7 的偏移量教训

③ 算 score（§2 的公式）

④ 写 rank:hot:{range}:v{n}          ZSet   member=postId  score=score
   rank:hot:{range}:meta:v{n}       Hash   postId → JSON{title, communityName, authorId, heat, ...}

⑤ SET rank:hot:{range}:current = n        ← 唯一的一条原子切换
```

`n` 是递增版本号。读者先取 `current` 再读那两个 key，**切换是原子的**，
不会出现"新分数配旧标题"。

### 5.2 为什么标题要写进 Redis

如果读榜单时再批量查 content 拿标题，就是**读路径跨服务同步调用**（违反不变量 2），
而且一次 50 条。

所以标题/社群名在重建时写进 meta hash。**这是快照不是事实**——
榜单只活 5 分钟，标题改了下次重建就跟上。

### 5.3 读接口

```
GET /api/rank/hot?range=day|week    游客可读
→ { items: [{ rank, postId, title, communityName, authorId, heat }] }
```

零跨服务调用：`GET current` → `ZREVRANGE` → `HMGET`。

### 5.4 重建失败时保留上一版

拿不到 content 或 interaction 的数据时，**不清空榜单**，保留上一版并记 WARN。

清空会让用户看到"热榜空了"，而实际上是下游抖动。这条是硬要求：
**投影坏了要退化，不能连坐。**

## 6. 新增计数

### 6.1 `t_post` 加三列（content V6）

```sql
ALTER TABLE t_post
  ADD COLUMN view_count          INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN share_count         INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_interaction_at DATETIME(3) NULL,
  ADD KEY idx_status_created (status, created_at, id),
  ADD KEY idx_status_last_interaction (status, last_interaction_at, id);
```

`last_interaction_at` 的写入者：content 自己——
消费 `InteractionChange` 时更新，评论写入时顺手更新。
**这也是 content 第一次从"纯消费者"变成"消费后还要写自己表"**，
但只改这一列，不涉及计数口径。

### 6.2 浏览量：Redis 缓冲 + 定期回写

```
GET /posts/{id}  →  Redis INCR view:post:{id}
每 60s           →  批量 flush 到 t_post.view_count，然后 DEL
```

**为什么不能直接 `UPDATE t_post SET view_count = view_count + 1`**：

1. 让 `GET` 变成写操作——语义被破坏、不能再缓存
2. 热点帖每看一次打一次 MySQL，成为写热点
3. 与 L0（nginx）/ L1（Caffeine）缓存**根本不兼容**：缓存命中时请求到不了服务

Redis 挂了丢一批计数——**这就是"不要求精确"的含义**。

### 6.3 分享：需要一个新端点

现在分享是纯客户端的（`navigator.clipboard`），服务端不知道。

```
POST /api/content/posts/{id}/share   游客可调用
→ { shareCount }
```

允许匿名（分享本身不该要求登录），代价是可被刷——P7 再加限流。

## 7. 一个已知的坑：批量 id 有长度上限

`/internal/counts` 的批量上限是 200，不是 500——500 个 target 约 12KB query string，
Tomcat 在进 controller 之前就返回 400。这个坑 P3 已经踩过一次。

所以重建时的批量调用**必须分批**，而且批大小要小于上限（取 100 更安全）。

## 8. 评论热度排序

```
GET /api/content/posts/{id}/comments?sort=time|hot&cursor=&limit=
```

- **默认 `time`**：现状不变，P3 的断言全部照旧
- `hot`：`ORDER BY like_count + reply_count DESC, created_at ASC`

⚠️ 游标问题：`CursorCodec` 现在的载荷是 `sort:millis:id`（整数时间戳）。
热度排序需要 **score + 打破平局**，得扩展成支持整型 score：
`sort:score:createdAtMillis:id`。

**整数化**而不是浮点：`like_count + reply_count` 本来就是整数，不需要浮点精度。

## 9. 切片

| 切片 | 内容 | 完成标志 |
|---|---|---|
| **P5.0** | `t_post` 加三列 + 两个索引；interaction 加窗口聚合索引；content 写 `last_interaction_at`；浏览量 Redis 缓冲 + 回写；分享端点 | curl 能看到计数在涨 |
| **P5.1** | content `/internal/rank/candidates`（分页）；interaction `/internal/counts/since`（分批） | 两个接口能拉出真实数据 |
| **P5.2** | rank-service 接 Redis + 公式 + 版本化原子切换 + 失败保留上一版 + Nacos 权重 | Redis 里出现 v1 与 current，5 分钟自动重建 |
| **P5.3** | `GET /api/rank/hot` + 前端热榜页接真数据 | 浏览器里看到真实排名 |
| **P5.4** | 评论热度排序（`CursorCodec` 扩展 + `sort` 参数 + 前端切换） | 时间序不受影响，热度序可用 |
| **P5.5** | 用真实数据跑一遍调参；`verify-p5.sh` | 验收全绿，排序符合直觉 |

## 10. 验收（`verify-p5.sh`）

### L1 契约

- OpenAPI 与网关放行规则一致（含新端点）
- 热度权重能从配置读出来（改一个值，重建后排序变化）
- `t_post` 的三列与两个索引存在

### L2 计数

- 浏览详情页 → `view_count` 增长（允许 60 秒延迟）
- 分享 → `share_count` + 1
- 互动后 `last_interaction_at` 被更新

### L3 重建与切换

- 删掉 Redis 的 `rank:hot:*`，5 分钟内自动回来（**可全量重建**）
- 重建过程中并发读 50 次，0 错误（roadmap 的验收标准）
- **content 停掉时重建不清空榜单**，保留上一版

### L4 公式正确性

- 收藏不涨热度是**错的**了——现在收藏要涨，且权重大于点赞
- 评论权重 > 收藏 > 分享 > 点赞 > 浏览（同数量级下）
- 同热度时，`last_interaction_at` 更新的排前面
- 窗口外的老帖不参与（`0.5^30` 那种）

### L5 评论排序

- 不加 `sort` 时行为与 P3 完全一致（护住旧断言）
- `sort=hot` 时点赞多的评论在前
- 热度序的游标翻页不重不漏

### L6 回归

- `verify.sh` / `verify-p05.sh` / `verify-p1.sh` / `verify-p2.sh` / `verify-p3.sh` / `verify-p4.sh` 全绿
