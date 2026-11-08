# kuaikan 架构方案

> 本文是技术方案汇总。术语以 `CONTEXT.md` 为准，不可回退的决策见 `docs/adr/`，可变的运行事实（实际版本号、域名、端口）见 `docs/project.md`。

## 1. 系统概览与范围

一个以**社群**为单位组织内容的讨论社区。用户注册后加入社群，在其中发帖、评论、点赞、收藏；他人对自己内容产生的互动会以**消息**形式投递，并带未读数红点。

**社群全程公开**：所有社群的内容对游客可见，加入无需审批、无门槛，结算即生效。**一期不做私密社群、不做加入审批**——这条是刻意砍掉的，它让读路径不必携带任何权限判断，也让 Nginx 游客缓存成立。

角色：游客（可读全部内容）→ 用户 → 社群成员 → 管理员（社群级）→ 社群主（社群级）→ 平台运营（全局封禁）。被封禁的用户**降级为游客，仍可浏览**，只是不能登录与发言。

## 2. 进程清单

1 网关 + 7 服务 = 8 个进程，共用一个 MySQL 实例但各自独立 schema（ADR 0006）。

| 进程 | 拥有的写模型 | 主要职责 |
|---|---|---|
| `gateway` | 无 | 路由（统一前缀 `/api/**`）、JWT 验签、Redis 白名单校验、注入身份头、限流 |
| `user-service` | `user` schema | 注册登录、JWT 签发与 JWKS、用户资料、关注关系、封禁 |
| `community-service` | `community` schema | 社群创建、加入/退出、成员角色、禁言 |
| `content-service` | `content` schema | 帖子与评论读写、计数快照、评论热度排序、发布领域事件 |
| `interaction-service` | `interaction` schema | 点赞与收藏的事实、计数增量、事件投递 |
| `notification-service` | `notification` schema | 消费互动事件、消息、未读计数、SSE 推送 |
| `search-service` | ES 索引（投影） | 消费内容事件建索引、全文检索 |
| `rank-service` | Redis ZSet（投影） | 定时拉取窗口内帖子算热榜，可随时全量重建 |

**`rank-service` 与 `search-service` 是读侧投影，不拥有任何事实。** 数据只来自事件订阅或对 `content-service` 的内部只读接口：

- `search-service` → **订阅** `PostCreated` / `PostUpdated` / `PostDeleted`（全文检索需要准实时）。
- `rank-service` → **定时拉取**（每 5 分钟向 `content-service` 要窗口内帖子的 `(postId, likeCount, commentCount, createdAt)`）。热榜本来就是定时重算的，为它铺事件流是过度设计，且能把事件量砍掉一个数量级。

**内部接口纪律**：所有仅供服务间调用的接口统一挂在 `/internal/**` 前缀下，**网关不得路由 `/internal/**`**，否则等于把数据出口直接开在公网上。

## 3. 技术栈

版本矩阵以 P0 spike 实测结果为准，**不采信外部博客**。下表"系列"是约束，"补丁号"待 spike 后回填 `docs/project.md`。

| 层 | 选型 | 系列 |
|---|---|---|
| JDK | Eclipse Temurin | 21 LTS |
| 框架 | Spring Boot | 3.5.x |
| 微服务 | Spring Cloud | 2025.0.x（须与 Boot 精确对齐） |
| 注册/配置 | Nacos | 2.4.x（Server 与 SCA 客户端对齐） |
| 网关 | Spring Cloud Gateway | 随 SC |
| RPC | OpenFeign + LoadBalancer | 随 SC |
| 限流熔断 | Sentinel | 1.8.x（规则持久化到 Nacos） |
| 消息 | RocketMQ | 5.3.x（Proxy 与 Remoting 二选一，不混用） |
| ORM | MyBatis-Plus | 3.5.x |
| 数据库 | MySQL | 8.4 LTS（一主一从） |
| 缓存 | Redis | 7.4.x |
| 搜索 | Elasticsearch + IK | 8.x |
| 链路追踪 | SkyWalking | 10.x（**存储用内置 BanyanDB，不占用 ES**） |
| 指标 | Prometheus + Grafana | 最新 |
| 日志 | Loki + Promtail | 最新 |
| 调度 | XXL-Job | 2.4.x |
| 对象存储 | MinIO | 最新（P7 才接） |
| 入口 | Nginx | 1.27.x |
| 前端 | React 19 / TS 5.x / Vite 7 / TanStack Query v5 / Zustand / Tailwind 4 + shadcn/ui | — |

**已明确排除**：Dubbo（ADR 0002）、BFF（ADR 0005）、**Seata**（本地消息表已取代全部分布式事务场景，见 ADR 0004）、分库分表、多可用区、RocketMQ 事务消息（ADR 0004）、Spring Authorization Server / Keycloak、私密社群与加入审批、一期图片上传（P7 才接 MinIO）。

## 4. 请求链路

**A. 游客读**：浏览器 → Nginx（命中 `proxy_cache`）→ 网关（放行名单）→ 服务 → 返回。响应中不得包含任何用户相关字段。

**B. 登录读**：前端并发三路 —— `GET /api/content/posts/{id}`（正文 + 作者摘要 + 计数快照）、`GET /api/content/posts/{id}/comments?cursor=`、`GET /api/interaction/states?targets=post:1,comment:2,comment:3`（批量查询多目标的"我赞过没/收藏没"）。绕过 Nginx 缓存。

**C. 写 + 事件**：客户端 → 网关 → 服务本地事务（业务表 + `t_outbox`）→ XXL-Job 扫 outbox 投递 RocketMQ → 消费方幂等消费。跨服务无分布式事务。

## 5. 鉴权

见 ADR 0003。要点：RS256 签发、access 2h / refresh 30d 轮换、网关唯一验签点、Redis 白名单 `auth:session:{jti}`、下游只读 `X-User-Id` / `X-User-Roles`。

三种失效语义互相独立：**登出**（删单个 jti）、**踢下线**（删该用户全部 jti）、**封禁**（改用户状态 + 清空全部 jti + 登录接口拒绝，但浏览不受限）。

## 6. 事件目录与契约

| 事件 | 生产方 | 消费方 | 载荷要点 |
|---|---|---|---|
| `PostCreated` | content | search | postId, communityId, authorId, title, createdAt |
| `PostUpdated` | content | search | postId, title, bodyVersion |
| `PostDeleted` | content | search | postId |
| `CommentCreated` | content | notification | commentId, postId, rootId, authorId, replyToUserId, mentionUserIds, excerpt |
| `LikeAdded` / `LikeRemoved` | interaction | content（计数）、notification（仅 Added） | eventId, actorId, targetType, targetId, targetOwnerId |
| `UserBanned` | user | notification | userId, reason |
| `LocalCacheEvict`（广播） | content, user | 全部 | cacheKey |

**收藏不产生消息**，也不发事件——收藏是用户的私密行为，只有计数变化（由 interaction 与 content 之间的内部接口或事件处理，见 §7）。

**契约演进规则**：topic 命名 `kuaikan.{domain}.{event}`；事件体固定携带 `eventId` / `version` / `occurredAt`；**只允许追加可选字段，禁止修改字段语义、禁止删除字段**；破坏性变更必须换新 topic 名并双写过渡。

**消费幂等三件套**（优先级从高到低）：写事实用 `INSERT IGNORE` + 唯一索引看 affected rows → 消费侧 `t_consume_log(event_id, consumer)` 唯一索引 → 一切计数都有对账任务兜底。

## 7. 计数归属

**每个计数只有一个写入者，不存在双写。**

| 计数字段 | 所有者 | 口径 | 更新方式 | 一致性 |
|---|---|---|---|---|
| `post.comment_count` | content | **该帖所有层级的评论总数**（删评论后递减，tombstone 占位不计） | 评论写入/删除的同一本地事务 | 强一致 |
| `comment.reply_count` | content | **直接子节点数**，非后代总数 | 本地事务 | 强一致 |
| `post.like_count` / `post.favorite_count` | content | — | 消费 interaction 事件 | 允许滞后 ≤5s |
| `comment.like_count` | content | — | 消费 interaction 事件 | 允许滞后 ≤5s |
| `community.member_count` | community | — | 本地事务 | 强一致 |
| `unread:{userId}` 四类 | notification（Redis） | 点赞/评论/@/系统 | 事件 + 已读操作 | 允许漂移，每日对账 |
| 热度 / 热榜 | rank（Redis ZSet） | 见下 | 每 5 分钟定时重算 | 按窗口重算 |

**热度 = 点赞数 + 评论数，收藏不计入。**（对齐贴吧口径；权重仍外置 Nacos 配置以便日后调整。）热榜只做日榜与周榜，只取 Top 50，不做深度分页、不留存历史名次。

## 8. 缓存分层

| 层 | 位置 | 内容 | 失效方式 |
|---|---|---|---|
| L0 | Nginx `proxy_cache` | 游客可读的帖子详情/列表 | TTL + `proxy_cache_purge` |
| L1 | Caffeine（进程内） | 帖子详情、社群信息 | TTL + `LocalCacheEvict` 广播 |
| L2 | Redis | 帖子详情、计数、用户摘要、未读数、榜单 | 主动删除 + TTL 抖动 |

- **穿透**：Redisson 布隆过滤器 + 短 TTL 空值缓存。
- **击穿**：逻辑过期 + 互斥重建（Redisson 锁，未抢到锁的请求返回旧值）。
- **雪崩**：TTL 随机抖动。
- **一致性**：L1 失效靠 RocketMQ 广播。**这是缓存一致性问题，不是数据一致性问题**，允许毫秒级窗口。

## 9. 数据模型草案（16 表）

| schema | 表 | 关键字段 |
|---|---|---|
| user | `t_user` | id, email, nickname, avatar_url, password_hash, status, created_at |
| user | `t_refresh_token` | jti, user_id, expires_at, rotated_from, revoked |
| user | `t_user_follow` | follower_id, followee_id, created_at（唯一索引） |
| community | `t_community` | id, slug, name, description, owner_id, member_count, status |
| community | `t_community_member` | community_id, user_id, role, status, muted_until, joined_at（唯一索引） |
| content | `t_post` | id, community_id, author_id, title, body, like_count, comment_count, favorite_count, view_count, status, created_at |
| content | `t_comment` | id, post_id, root_id, parent_id, author_id, reply_to_user_id, body, like_count, reply_count, status, created_at |
| content | `t_post_mention` / `t_comment_mention` | 目标 id, mentioned_user_id（唯一索引） |
| content | `t_outbox` | id, event_id, topic, payload, status, retry, next_retry_at, created_at |
| content | `t_consume_log` | event_id, consumer, created_at（唯一索引） |
| interaction | `t_like` | id, user_id, target_type, target_id, created_at；唯一 `(user_id,target_type,target_id)`；索引 `(target_type,target_id,created_at,id)` |
| interaction | `t_favorite` | id, user_id, post_id, created_at（唯一索引） |
| interaction | `t_outbox` | id, event_id, topic, payload, status, retry, next_retry_at, created_at |
| interaction | `t_consume_log` | event_id, consumer, created_at（唯一索引） |
| notification | `t_message` | id, user_id, type, actor_id, actor_nickname, actor_avatar, target_type, target_id, target_title, excerpt, read_at, created_at；索引 `(user_id,type,created_at,id)` |
| search | ES 索引 `post_v1` | IK 分词 title/body, communityId, authorId, createdAt |

**消息类型只有四种**：`LIKE` / `COMMENT` / `MENTION` / `SYSTEM`。"评论了你的帖子"与"回复了你的评论"同为 `COMMENT`，用 `reply_to_user_id` 是否为空区分文案，**不新增类型**。

**所有主键为雪花 ID（`BIGINT`），全局 Jackson 将 `Long` 序列化为字符串。所有删除为逻辑删除。所有列表分页用游标（`created_at, id`），不用 `offset`。**

## 10. 不变量（Invariants）

违反以下任一条，架构即退化为分布式单体。新增功能前先对照这一页。

1. **一个聚合只有一个所有者**；跨服务不 `JOIN`，跨 schema 不连接（→ ADR 0006）。
2. **读路径禁止跨服务同步调用**；写路径允许一次，且必须有超时与降级（→ ADR 0005）。
3. **主键雪花 ID**，`Long` 一律序列化为字符串。
4. **删除一律逻辑删除**，物理清理只能由异步任务做。
5. **展示用的数字允许漂移，决策用的状态不允许**（点赞数可滞后，我赞过没不可滞后）。
6. **每个计数都有且只有一个写入者**，且都有对账任务。
7. **服务端口不得暴露公网**，公网只开 Nginx 的 443；**网关不得路由 `/internal/**`**（→ ADR 0003）。
8. **`kuaikan-common` 只放非业务代码**。
9. **消息是自包含快照**；**存储不折叠，展示才折叠**。
10. **所有消费者必须幂等**，幂等优先级：唯一索引 > 去重表 > 对账兜底。
11. **列表分页一律游标**，禁止 `offset` 深分页。
12. **游客可读的接口必须在网关放行名单中显式声明**，不得靠"忘记加鉴权"实现。
13. **事件契约只允许追加可选字段**，破坏性变更换 topic 名（见 §6）。
14. **单环境纪律**：数据库变更必须向后兼容，每次发布保留上一版镜像 tag 可回滚（→ ADR 0007）。

## 11. 定时任务（XXL-Job 统一调度）

所有任务一律**幂等 + 可重跑 + 支持分片广播**，禁止依赖"只执行一次"的前提。多实例下重复执行必须无副作用（覆盖式写入，不做增量累加）。

| 任务 | 频率 | 职责 | 幂等策略 |
|---|---|---|---|
| `outbox-relay` | 每 10s | 扫描各服务 `t_outbox` 中未发送记录，投递 RocketMQ | 以 `status` 条件更新抢占，失败退避重试 |
| `count-reconcile` | 每 10min | 用 `t_like` / `t_favorite` 重算热门目标计数并覆盖 Redis 与冗余列 | 覆盖式写入 |
| `unread-reconcile` | 每日 | 用 `t_message.read_at` 重算四类未读数并覆盖 Redis | 覆盖式写入 |
| `rank-rebuild` | 每 5min | 拉取窗口内帖子，重算日榜/周榜 ZSet | 全量重建，先写临时 key 再 `RENAME` |
| `message-archive` | 每日 | 物理删除 6 个月前的 `t_message` 与已删帖评论 | 按天分批，带删除上限 |
| `index-rebuild` | 手动/每周 | 全量重建 ES 索引（`post_v1` → 别名切换） | 别名切换，零停机 |

## 12. 部署

见 ADR 0007。**8 个 Java 服务与全部中间件一律容器化，全部运行在同一台境外云服务器上。只有一套环境，没有本地环境、没有预发环境。**

### 单一环境

- **单一 Compose 网络**，所有进程同一地址空间；**只有网关向宿主机映射 `127.0.0.1:8080`**，其余端口一律不映射（ADR 0003 硬约束）。
- **宿主机 nginx 是唯一监听 443 的进程**（ADR 0007 的显式例外）：TLS 终止 → 静态资源 → `/api/` 反代到 `127.0.0.1:8080`。配置在 `deploy/nginx/kuaikan.conf`，由 `deploy/nginx/install.sh` 安装。
- **profile 分组**：`core`（MySQL / Redis / RocketMQ / Nacos）、`app`（8 个 Java 服务 + Nginx）、`observe`（Prometheus / Grafana / Loki / SkyWalking）、`extra`（ES / MinIO）。
- **多阶段 Dockerfile**：`maven:3.9-eclipse-temurin-21` 构建 → `eclipse-temurin:21-jre` 运行；依赖层与 jar 层分离，并用 BuildKit `--mount=type=cache,target=/root/.m2` 持久化 Maven 依赖。
- **构建只能在服务器（x86_64）或 CI 上做**。开发机是 Apple Silicon，本地构建的镜像在服务器上会 `exec format error`。
- **健康检查**统一用 `/actuator/health/readiness`，Compose 以 `depends_on: condition: service_healthy` 控制启动顺序。
- **JVM 参数**统一 `-XX:MaxRAMPercentage=70`，并在 Compose 里用 `deploy.resources.limits.memory` 设硬上限；不显式限制会按宿主机内存算堆导致 OOMKilled。

### 迭代与回滚

- 迭代粒度是**单个服务**：`docker compose up -d --build <service>`。首次构建 5~8 分钟，之后 30~90 秒。
- **每次发布保留上一版镜像 tag**（`content-service:20250101-a1b2c3`），回滚＝改 tag 后 `up -d`。这是单环境唯一的兜底手段。
- **数据库变更必须向后兼容**：先加列、后使用、不删列。单环境没有预发环境可试错，破坏性迁移等于直接故障。

### 容器化的三个已知坑（P0 就会碰到）

1. **Nacos 注册的是容器 IP**，跨 Compose 网络不可达——所有服务必须在同一网络内。
2. **JVM 不显式限堆会看宿主内存**——必须同时设 `MaxRAMPercentage` 与容器内存上限。
3. **启动顺序**——Nacos / RocketMQ 未就绪时服务注册会失败并刷屏重试，必须靠 healthcheck + `service_healthy` 挡住。

### 磁盘预算（80GB）

| 项 | 估算 |
|---|---|
| OS | 8 GB |
| 中间件镜像 | 7 GB |
| 8 个服务镜像 | 2 GB |
| Maven 构建缓存 | 4 GB |
| MySQL 数据 + binlog（一主一从） | 4 GB |
| RocketMQ 存储 | 3 GB |
| ES 索引 + 固定开销 | 3 GB |
| Redis RDB/AOF | 1 GB |
| 日志（容器 + Loki） | 5 GB |
| 本地备份副本 | 5 GB |
| **合计占用** | **≈ 42 GB（余 38 GB）** |

**四条必须配置的约束**，否则会爆盘：

1. **容器日志必须轮转**：每个服务 `logging.options.max-size: 50m` + `max-file: "3"`，Docker 默认无上限。
2. **RocketMQ commitlog 按 1GB 预分配**，需监控 store 目录并按 `fileReservedTime` 清理。
3. **MySQL `expire_logs_days` 显式设为 7**，主从两份 binlog 会长期占用。
4. **ES 磁盘 85% 会把索引自动设为 read-only**，是功能失效而非降速——整盘水位保持 70% 以下。

Nginx 需为 SSE 端点关闭 `proxy_buffering`，并把网关与 Nginx 的超时都设到大于心跳间隔（心跳 15s）。

## 13. 遗留风险与开放项

| 项 | 状态 | 说明 |
|---|---|---|
| Spring Cloud Alibaba 版本矩阵 | **开放** | P0 spike 一票否决，不通则整体降版本 |
| 雪花 `workerId` 分配 | 已定 | 各服务固定 `datacenterId` 段；实例序号由 `POD_NAME` / Nacos 实例元数据推导；上线前做一次 ID 唯一性校验 |
| SSE 超时链 | 已定 | 心跳 15s，网关与 Nginx 超时均 > 30s |
| ES 与 SkyWalking 内存 | 已定 | ES heap 固定 512M；SkyWalking 用内置 BanyanDB，不占 ES |
| 邮件服务商 | **开放** | P1 实施时选型（SMTP 自建 / 第三方 API 二选一） |
| 搜索可见性 | 已消解 | 社群全程公开，全部帖子入索引 |
| 开发机与服务器 CPU 架构不一致 | 已定 | 只在服务器/CI 构建镜像，禁止 Mac 本地构建后推送 |
