# kuaikan 技术事实

> 只记录**可验证的事实**（已实测的版本号、容量目标、域名、端口、部署位置）。设计取舍与不变量见 `docs/design/architecture.md`，术语见 `CONTEXT.md`，不可回退的决策见 `docs/adr/`。

## 定位

以社群为单位组织内容的讨论社区。架构评审已完成，尚未开始编码。

## 容量基线

用于所有技术选型的判据。**万级用户指注册量，不是并发量。**

| 指标 | 目标值 |
|---|---|
| 注册用户 | 10,000 |
| 日活 | 500 ~ 1,000 |
| 峰值并发连接 | ≤ 50 |
| 峰值 QPS（含静态资源，前端走 Nginx） | ≤ 300 |
| 帖子里程碑 | 5 万 |
| 评论里程碑 | 50 万 |
| 单条帖子的点赞上限（设计假设） | 5,000 |
| 点赞/收藏总量里程碑 | 200 万 |
| 站内消息里程碑 | 100 万 |
| 单条读接口 P95 | < 200ms |
| 互动消息端到端延迟 | < 5s |
| 计数允许滞后上限 | 5s |

结论：MySQL 单实例 + 一主一从足够；Redis 单实例足够；RocketMQ 单 Master 足够；Elasticsearch 单节点足够。分库分表、多可用区明确不做。

## 模块结构

```
services/
├── kuaikan-common        零 Spring 依赖：Result / ErrorCode / ErrorHttpStatus / AuthErrorCode /
│                          UserContext / Headers / Services / Topics（网关也能用）
├── kuaikan-common-web    依赖 Spring Web：Jackson Long→String 等 servlet 侧基础设施
│                          （网关**不依赖**它，避免 WebFlux 进程被 servlet 栈污染）
├── gateway + 7 个服务
```

## 进程与存储

1 网关 + 7 服务 = 8 个进程，共用一个 MySQL 实例，各自独立 schema（见 ADR 0006）。

| 进程 | 拥有的 schema / 投影 |
|---|---|
| `gateway` | 无 |
| `user-service` | `user` |
| `community-service` | `community` |
| `content-service` | `content` |
| `interaction-service` | `interaction` |
| `notification-service` | `notification` |
| `search-service` | ES 索引（投影，无写入事实） |
| `rank-service` | Redis ZSet（投影，无写入事实） |

各进程的职责与不变量见 `docs/design/architecture.md`。

### 服务边界按聚合归属划，不按产品概念划

一个很容易卡住的地方，写在这里免得每个新人都问一遍：

**「互动」是产品概念，不是服务边界。** 评论看起来和点赞是同一类功能，但它们分属两个服务：

| 产品概念 | 在哪个服务 | 本质 |
|---|---|---|
| 评论 / 回复 | `content-service` | 它**是内容**：正文、两级层级、进 `post.comment_count` |
| 点赞 / 收藏 | `interaction-service` | 它是**关系**：一行「A 赞了 B」，没有正文 |

⚠️ `interaction-service` 这个名字**有误导性**。它不拥有所有互动，只拥有「不含正文的二元关系」。带正文的互动（评论、回复）在 content。

边界是不变量逼出来的：评论若进 interaction，`comment_count` 就无法与评论插入同事务（ADR 0010 要强一致，ADR 0004 已删 Seata），帖子详情页要多两次跨服务同步调用（违反不变量 2），且跨 schema 无法 JOIN（ADR 0006）。而点赞三条都不需要——`like_count` 允许最终一致。

通记规则：**谁拥有这个聚合，谁发这个事实的事件。** 所以事件生产方天然是分散的：

| 事实 | 生产方 | topic |
|---|---|---|
| 有人评论/回复 | content | `kuaikan_comment_created` |
| 有人点赞/收藏 | interaction | `kuaikan_interaction_changed` |
| 有人被封禁 | user | `kuaikan_user_banned` |

## 运行环境

| 项 | 值 |
|---|---|
| 服务器 | `206.237.30.147`，Ubuntu 24.04.1 LTS，x86_64，8 vCPU / 15 GiB / 79 GB |
| 登录 | `root`，密钥 `~/.ssh/pi_cloud`，端口 22 |
| 域名 | `www.katzenyasax.top`（主站），`katzenyasax.top` 301 → www；DNS 均已指向本机 |
| TLS | Let's Encrypt，有效期至 2027-02-06，`certbot.timer` 自动续期，续期后自动 reload nginx |
| 边缘代理 | **宿主机 nginx 1.24**（ADR 0007 显式例外），配置源自 `deploy/nginx/` |
| 公网端口 | 仅 22 / 80 / 443（UFW + 云安全组） |
| 上游 | 网关容器只绑 `127.0.0.1:8080`，nginx `/api/` 反代至此 |
| 静态站点 | 全部由 React 应用渲染：`/` 首页入口、`/register` 注册、`/test` 诊断台。发布只走 `deploy/bin/deploy-web.sh` |
| 前端产物目录 | `/opt/kuaikan/frontend/dist`（唯一目录，含 SPA 全部路由） |
| 部署根目录 | `/opt/kuaikan/{deploy,data,logs,backup}` |
| 部署形态 | **全组件容器化**（8 个 Java 服务 + 全部中间件），nginx 除外 |
| 环境数量 | **1 套**（无本地环境、无预发环境） |
| 镜像构建位置 | 服务器（x86_64）或 CI；**禁止在 arm64 开发机构建后推送** |
| 回滚手段 | 保留上一版镜像 tag |
| 磁盘 | 80 GB，预算占用 ≈ 42 GB |
| 交换分区 | 4.4 GB（`/swap.img` 1.4G + `/swapfile` 3G） |
| 时区 | Asia/Shanghai，NTP 已同步 |

## 本机开发环境（实测）

**本机只做编辑与 git，不承担后端构建。** 后端编译与镜像构建全部在服务器容器内完成。

| 工具 | 状态 | 用途 |
|---|---|---|
| macOS | 27.0，arm64 | — |
| Node | **22.23.4**（`~/.local/node/current`，PATH 优先） | 前端本地开发、HMR、构建 |
| npm | 10.9.9 | 包管理，**不使用 pnpm / yarn** |
| Homebrew | 5.1.11 | |
| Homebrew 的 node | 25.8.0（未删除，`brew link node` 可切回） | 仅作备用 |
| git / ssh / rsync | 有 | 代码同步与运维 |
| **Java** | ❌ 无（仅系统自带 17，非 21） | 不用于本项目 |
| **Maven / Gradle** | ❌ 无 | 编译在服务器容器内 |
| **Docker** | ❌ 无 | 镜像构建在服务器 |

### Node 版本的由来

本机原为 Homebrew 的 Node 25.8.0（奇数版、非 LTS）。因 **Homebrew 5.1.11 不认识 macOS 27.0**，`brew install node@22` 会报 `Error: unknown or unsupported macOS version: :dunno`（依赖已装齐，失败发生在 bottle 选择阶段）。故改用 **nodejs.org 官方 tarball**（SHA256 已校验）安装到 `~/.local/node/node-v22.23.4-darwin-arm64`，由 `~/.zshrc` 中的 PATH 前置生效。

### 前端工具链（S1 实测）

| 包 | 版本 |
|---|---|
| react / react-dom | 19.3.1 |
| vite | **8.3.7** |
| @vitejs/plugin-react | 6.3.0 |
| typescript | **6.0.3** |
| eslint / @eslint/js | 10.14.0 / 10.0.1 |
| typescript-eslint | 8.72.2 |
| eslint-plugin-react-hooks | 7.1.1 |
| @types/node | 26.6.6 |
| react-router | **8.5.1** |
| @tanstack/react-query | 5.107.1 |
| tailwindcss / @tailwindcss/vite | 4.3.5 |
| clsx / tailwind-merge | 2.1.1 / 3.7.0 |
| openapi-typescript | 7.13.0（peer 声明 TS ^5，用 `legacy-peer-deps` 安装，实测兼容 TS 6） |
| tsx | 4.23.15 |
| Node 运行时 | 22.23.4（`~/.local/node/current`） |
| **zustand** | 未安装，P1 有会话 store 时再引入 |

前端产物（S5 后）：`index.js` 389.85 KB（gzip 122.36 KB）、`index.css` 13.23 KB（gzip 3.55 KB）。

`web/.node-version` 固定 22.23.4；`package.json` 的 `engines.node` 为 `>=20.19 <23`。
**开发机上共存 3 个 Node**：`/usr/local/bin/node`(22.22.1)、`/opt/homebrew/bin/node`(25.8.0)、`~/.local/node/current`(22.23.4)。
所有 npm 命令必须显式 `export PATH="$HOME/.local/node/current/bin:$PATH"`，`web/.node-version` 只约束工具不约束执行。

### 前后端两条回路

| | 回路 | 耗时 |
|---|---|---|
| **后端** | 本地编辑 → commit + push → 服务器 `git pull` → `docker compose up -d --build <service>` | 单服务 30~90 秒 |
| **前端** | 本地 `npm run dev`（Vite HMR，`server.proxy` 把 `/api` 指向 `https://www.katzenyasax.top`） | 秒级 |
| 前端发布 | 本地 `npm run build` → 产物同步到服务器 `/opt/kuaikan/frontend/dist` | — |

## 已装软件（服务器实测）

| 组件 | 版本 |
|---|---|
| Docker Engine | 29.9.3 |
| Docker Compose | v5.7.0 |
| buildx | v0.38.1 |
| nginx | 1.24.0（Ubuntu） |
| certbot | 2.9.0 |

## 已运行的中间件（core profile）

| 组件 | 镜像 | 容器状态 | 内存 |
|---|---|---|---|
| MySQL | `mysql:8.4.13` | healthy | 451 MB |
| Redis | `redis:7.4.12-alpine` | healthy | 3 MB |
| Nacos | `nacos/nacos-server:v3.0.3` | healthy | 680 MB |
| RocketMQ NameServer | `apache/rocketmq:5.3.4` | healthy | 226 MB |
| RocketMQ Broker | `apache/rocketmq:5.3.4` | healthy | 730 MB |

合计常驻约 **2.1 GB**，磁盘占用 15 GB / 79 GB（20%）。

关键配置（已实测生效）：

| 项 | 值 |
|---|---|
| MySQL 字符集 / 时区 | `utf8mb4` / `+08:00` |
| MySQL binlog 保留 | 7 天 |
| MySQL buffer pool / 最大连接 | 512 MB / 300 |
| MySQL schema | `kuaikan_user` `kuaikan_community` `kuaikan_content` `kuaikan_interaction` `kuaikan_notification` |
| MySQL 账号 | 每 schema 一个受限账号，**跨库访问实测被拒绝**（ADR 0006 生效） |
| Redis 持久化 / 淘汰策略 | AOF `everysec` + RDB / `noeviction`（禁止淘汰） |
| Redis 认证 | `requirepass`，未认证连接实测被拒 |
| Nacos 模式 | `standalone`，服务端认证关闭（内网） |
| RocketMQ 集群 | `KuaikanCluster` / `broker-a`，单 Master 异步刷盘，brokerIP1 `172.30.10.14` |
| RocketMQ commitlog 单文件 | 128 MB（非默认 1 GB） |
| 网络 | `kuaikan` bridge，`172.30.10.0/24`，中间件 IP 钉死 |
| 端口发布 | **core 全部端口未发布到宿主** |

## 已运行的业务服务（app profile）

| 服务 | 镜像 | 端口（容器内） | 常驻内存 |
|---|---|---|---|
| gateway | `kuaikan/gateway:dev` | 8080（**唯一映射宿主 `127.0.0.1:8080`**） | 376 MB |
| user-service | `kuaikan/user-service:dev` | 8081 | 274 MB |
| community-service | `kuaikan/community-service:dev` | 8082 | 370 MB |
| content-service | `kuaikan/content-service:dev` | 8083 | 295 MB |
| interaction-service | `kuaikan/interaction-service:dev` | 8084 | 307 MB |
| notification-service | `kuaikan/notification-service:dev` | 8085 | 305 MB |
| search-service | `kuaikan/search-service:dev` | 8086 | 314 MB |
| rank-service | `kuaikan/rank-service:dev` | 8087 | 315 MB |

全栈（core 5 + app 8 = 13 个容器）常驻内存约 **5.5 GB**，磁盘 19 GB / 79 GB（25%）。
构建：`docker compose build` 单服务约 30~45 秒（Maven 依赖命中 BuildKit 缓存），8 个服务全量构建 + 启动约 **1 分 50 秒**。

### P0 冒烟链路（第 4 步）

| 链路 | 端点 | 实测结果 |
|---|---|---|
| RocketMQ 发送 | `POST /api/user/ping/mq` | `SEND_OK`，返回 traceId / msgId / queue |
| RocketMQ 消费 | `GET /api/user/ping/mq/{traceId}` | 经 Feign 回查 community-service 内存台账，`received=true` |
| Sentinel 限流 | `GET /api/user/ping/sentinel` | 阈值 QPS=2，超出返回 **HTTP 429 + `{"code":42900,"message":"请求过于频繁"}`** |

| 指标 | 实测值 |
|---|---|
| MQ 首条消息端到端（消费组刚启动，含 rebalance） | 约 8 秒 |
| MQ 稳态端到端 | **372~386 ms** |
| Sentinel 规则 | 代码内 `FlowRuleManager.loadRules`，resource `p0Sentinel`，QPS 2 |
| RocketMQ topic | `kuaikan_p0_smoke`（**下划线，RocketMQ 不允许点号**） |
| 消费台账 | community-service 内存 `ConcurrentHashMap`，上限 1 万条，**重启即清空，不是去重表** |

### Long 序列化（P1.1 落地）

**所有 `Long` 全局序列化为字符串**（`kuaikan-common-web` 的 `JacksonConfig`，AutoConfiguration 注册）。

原因：JS 的 `Number` 只有 53 位精度，雪花 ID 是 19 位。实测 `2120067985624219650`
在 JS 里会变成 `2120067985624219648`——表现为"注册成功但查不到自己的账号"，日志里完全看不出来。

配套要求：**DTO 里的 ID 字段必须加 `@Schema(type = "string")`**，否则 OpenAPI 契约仍写 `int64`，
生成的 TS 类型是 `number`，与实际 JSON 不符。

代价：以后所有 `Long` 字段（包括计数）到前端都是字符串。需要时再单独处理。

### 认证（P1.2）

| 项 | 值 |
|---|---|
| 算法 | RS256，`kid` 用密钥指纹 |
| access | 2 小时，JWT（`typ=access`，含 `sub`/`jti`/`roles`） |
| refresh | 30 天，JWT（`typ=refresh`，含 `jti`/`fid` 家族），**库里只存 jti** |
| 私钥 | `/opt/kuaikan/data/auth-keys/jwt-private.pem`（挂载进容器 `/app/keys`，属主 10001，权限 600） |
| 公钥分发 | `GET /internal/jwks`（仅容器网络，公网 **404**） |
| refresh cookie | `kuaikan_refresh`：HttpOnly + Secure + SameSite=Lax + `Path=/api/user/auth` + 30 天 |
| access 白名单 | Redis `auth:session:{accessJti}` → userId（网关 P1.3 查它） |
| access 反向索引 | Redis **ZSet** `auth:user:{userId}:access`（member=jti，score=过期时间戳；踢下线时批量找） |
| 重放宽限期 | 30 秒（多标签页并发刷新不误判） |

**access 与 refresh 的存储分工**：access 白名单进 Redis（每请求热路径 + 立刻失效），
refresh 家族进 MySQL（可分页、可审计、低频）。这样不存在双写一致性问题。

### 测试账号（⚠️ 上线前必须删除）

**两个账号，分工不同，不要混用。**

| 用途 | 邮箱 | 密码 | 谁在用 |
|---|---|---|---|
| **脚本与自动化测试** | `agent@kuaikan.test` | `AgentFixture-9f3Kx2Qw` | `verify.sh` 的网关注入断言、日常 curl / Playwright 验证 |
| **人工 e2e** | `developer@kuaikan.test` | `katzenyasaxDeveloper` | 只有人手动点页面时用 |

为什么要分开：自动化脚本会反复登录、反复建社群、会话列表里塞满记录、
`last_login_at` 一直在变。**用一个账号兼顾两件事，人再去看"我的登录设备"时就分不清
哪些是自己真在用的设备。** 而且脚本一旦出错，污染的是人正在用的账号。

`verify-p1.sh` / `verify-p2.sh` 另有一套更彻底的做法：每次运行建临时账号
（`e2e+<时间戳>@kuaikan.test`），结束即删，完全不碰上面两个。

#### 两个账号的共同点

| 项 | 值 |
|---|---|
| 登录标识 | 邮箱（本项目**用邮箱登录，没有用户名字段**） |
| 角色 | `USER`（无任何管理权限） |
| 状态 | `NORMAL` |
| 域名 | `@kuaikan.test` 是不存在的域，收不到验证码，也不需要 |

创建方式与正常的偏离：**密码是用 SQL 直接写入的**，`password_hash` 是目标密码的
BCrypt 哈希（cost 10，与 `BCryptPasswordEncoder(10)` 一致，不引入第二套实现）。
`agent` 的哈希前缀是 `$2y$`（来自 `htpasswd -bnBC`），`developer` 的是 `$2a$`——
Spring 的 `BCryptPasswordEncoder` 两者都接受，已实测登录通过。

**改密码时必须顺带做两件事**（P7 的"修改密码"功能要照做）：
吊销该用户全部 refresh token（DB）+ 清空全部 access 白名单键（Redis）。
否则改密码只影响下一次登录，**已登录的设备仍然有效**——用户会以为"改了密码就安全了"。

**上线前动作**：删除这两个账号，或在发布清单里改成"仅在需要时临时创建、用完删除"。

### 网关鉴权（P1.3）

**网关是唯一验签点**，下游服务只从 header 读身份、不解析 JWT。

| 环节 | 实现 |
|---|---|
| 验签 | RS256，公钥按 `kid` 缓存；未知 kid 时刷新 JWKS；拉不到 → 不放行 |
| 公钥来源 | `http://user-service:8081/internal/jwks`（容器网络内直连服务名） |
| 白名单 | **必须用 `@ConfigurationProperties` 绑定**，`@Value` 绑不了 YAML 列表 |
| 作用域校验 | `exp` / `iss=kuaikan` / `typ=access`（防止拿 30 天的 refresh 当 access） |
| 白名单校验 | 响应式 Redis 查 `auth:session:{jti}`，**不做本地缓存** |
| 身份注入 | **先 remove 再 set** `X-User-Id` / `X-User-Roles` |
| 放行分支 | 同样剥离身份头，否则匿名请求带 `X-User-Id` 会被下游当成已登录 |
| 依赖不可用 | **fail-closed 503**（不是 200） |

放行名单（`kuaikan.auth.whitelist` + `public-patterns`）：

```
/api/user/auth/login
/api/user/auth/register
/api/user/auth/register/code
/api/user/auth/refresh
^/api/[^/]+/ping(/.*)?$        ← P0/P0.5 探针端点，P1 的已知债务
```

服务侧：`kuaikan-common-web` 的 `UserContextFilter` 从 header 构造 `UserContext`，
`finally` 里 `clear()`（ThreadLocal 不清理会在并发下把上一个请求的身份带给下一个）。
**只读 header，不验签、不校验签名**——网关是唯一信任源。

探针：`GET /api/community/whoami` 回报服务从 header 读到的身份。
**刻意不在 `/ping/**` 下**——那个前缀是放行的，放行分支会剥离身份头，放在那里永远匿名。
`verify.sh` 的 5b 段用它做断言：无 token → 401；带 token → 返回本人 id。

### 运维端点（P1.4）

只能从服务器上 `docker exec` 调用——网关不路由 `/internal/**`，公网访问会得到 404。

| 端点 | 作用 | 关键点 |
|---|---|---|
| `POST /internal/admin/kick` | 踢下线（不改账号状态，可重新登录） | 删 Redis access 白名单 + 吊销全部 refresh |
| `POST /internal/admin/ban` | 封禁（登录也会被拒） | 先改状态再撤销凭证，反过来的话中间有窗口能重登 |
| `POST /internal/admin/unban` | 解封 | 只改状态，保留 `banned_at`/`banned_reason` 作审计 |

```bash
docker exec kuaikan-user-service-1 \
  curl -s -X POST http://127.0.0.1:8081/internal/admin/ban \
  -H 'Content-Type: application/json' -d '{"userId":"<id>","reason":"..."}'
```

实测：ban 后该用户全部设备立刻 401、refresh 也 401、登录 403/40205，
但游客可读接口（`/ping`、首页）仍 200；kick 只影响目标用户，其他用户不受影响。

**refresh 里账号状态检查必须在"token 是否已吊销"之前**：封禁会吊销全部 refresh 行，
先判吊销就会先命中 REVOKED 返回 401，用户永远看不到"账号已被封禁"。

### 前端会话结束提示

`session.logoutReason` 三态：`manual` / `expired` / `banned`。

- `banned`：无条件设置（封禁是账号级事实，整页刷新后也要提示，否则用户只会反复重试登录）
- `expired`：只在"本来已登录、被动掉线"时设置（首次访问的 401 是正常的"没登录"）
- `manual`：主动登出，不提示

### 网关鉴权过滤器的一个真 bug（P2.3 修复）

`JwtAuthGlobalFilter` 原来把 `chain.filter(...)` 也套在最外层的 `onErrorResume` 里，
于是**任何下游异常**都被记成"鉴权依赖不可用"并替换成自己的 503。

现场是 L4 停掉 community-service 之后，网关日志报：

```
鉴权依赖不可用，拒绝请求 path=/api/community/communities
  err=NotFoundException: Unable to find instance for community-service
```

而 `/communities` 是公开路径、根本不需要鉴权。这条日志让排查方向直接跑偏到
鉴权上，同时下游的真实响应被吞掉。

改法：身份解析拆成 `authenticate()`，返回 `Optional<JWTClaimsSet>`，
`Optional.empty()` 表示"已拒绝并写完响应"；`chain.filter` 移到它的 `flatMap` 里，
下游错误不再进入鉴权那层的 `onErrorResume`。那个 `onErrorResume` 现在只覆盖
**取公钥**和**查 Redis 白名单**——两件真正需要 fail-closed 的事。

复测：无 token 401 / 有 token 200 / 篡改签名 401 / 登出后旧 token 401，
且下游 503 原样透出、误报次数 0。

### 消息跳转（P4.3 补做）

消息行整体可点，跳 `/c/{社群名}/p/{帖子id}?comment={评论id}`；
帖子页读到 `?comment=` 后滚到那条评论，高亮 2 秒淡出，并把参数摘掉。

`t_message` 因此加了三个字段（V2）：`community_name` / `post_id` / `comment_id`。

**为什么在写入时固化**：读一页消息要拼 20 个 URL，现查就是 20 次跨服务调用，
违反不变量 2。而消息本来就是快照。

`community_name` 要经 community-service（帖子路由用名字不用 id）。
**名字创建后不可改（它就是 URL），所以可以永久缓存**，加 1000 条上限防无限增长。
新增内部端点 `GET /internal/communities/{id}`，唯一用途就是让消息能跳转。

`TargetView` 也加了 `postId` / `communityId`——都是表中已有的列，
**不需要额外调用，所以点赞的写路径没有变慢**。
interaction 侧的副本刻意不跟着加：它用不到，反序列化会忽略未知字段。

#### 点开即已读

`POST /messages/{id}/read`，前端在 Link 的 `onClick` 里**不 await** 地发出去。

- **必须带 `user_id` 条件**：id 是雪花值，"猜不到"不是访问控制
- `read_at IS NULL` 让重复点击成为 no-op（返回 0，不是错误）
- 跳转不能等它返回——一个"顺手"的请求不该挡住导航。
  失败了只是红点多停一会儿，下次进抽屉重新拉未读数会纠正

#### 回复类消息要带 `root`，否则停在帖子页

评论区是两级平铺的，回复默认折叠在「展开 N 条回复」里。消息指向一条回复时，
前端在 DOM 里找不到那个节点，只能停在帖子页——这与"跳不到评论"是同一件事。

解法：`CommentCreated` 带 `rootCommentId` → `t_message.root_comment_id`（V3）→
前端 href 变成 `?comment=<id>&root=<rootId>`，跳转逻辑先点开那个 root 再滚。

**不在前端反推 root**：那要先拉全部评论再逐条找，是 O(n) 次请求。

顺带修了一个小问题：原来找不到锚点时参数会一直挂在地址栏，
现在无论成功与否都摘掉——否则刷新或分享链接会带着一个无效锚点。

#### 加字段不会修好已经写好的行

V2 上线后的一段时间里，评论/@ 消息仍然点不动——因为**那些行是旧实例写的**，
新的 `fillNavigation` 只对之后消费的事件生效。我当时的验证用的是自己新发的一条评论，
所以没发现用户的消息是部署前产生的。

这与"改消费逻辑就能修好历史数据"是同一个误解。修法只有一条：**迁移要连数据一起补**。
回填能做得干净，是因为信息可推导：

| 字段 | 回填来源 |
|---|---|
| `post_id` / `community_name` | `target_id` 就是帖子 id → join 帖子与社群 |
| `comment_id`（评论/@） | 消息存了 `source_event_id` → 回到 content 的 `t_outbox` 从载荷里取 `commentId` |
| `comment_id`（赞评论） | `target_id` 就是被赞的评论 |

**这条对以后所有"给消息加快照字段"的改动都成立**：字段加了，
历史行还是 NULL，必须同时写回填，否则新旧数据长得不一样。

#### 两个跳不过去的现实约束

1. **评论是游标分页的**，目标可能在第二页 → 查不到就继续等（最多约 3 秒），
   而不是"加载完立刻找一次"然后放弃
2. **目标若是回复**，它藏在「展开 N 条回复」里 → 退化为停在帖子页，
   **不自动展开**。自动展开别人没要求的回复比不滚过去更打扰

### P5.0 热度所需的数据基础（已完成）

| 件 | 位置 |
|---|---|
| `t_post` 加 `view_count` / `share_count` / `last_interaction_at` + 两个候选索引 | content V6 |
| `idx_kind_type_created` | interaction V2 |
| `PostViewCounter`（Redis 缓冲 + 60s 回写） | content |
| `POST /posts/{id}/share` | content（游客可调） |
| `last_interaction_at` 的两个写入者 | 消费互动事件 / 评论写入（同事务） |

#### 浏览量为什么不直接 UPDATE

让 `GET /posts/{id}` 变成写操作会同时踩三件事：

1. GET 语义被破坏——不能缓存、不能重试
2. 热点帖每看一次打一次 MySQL
3. **与缓存根本不兼容**：nginx 的 L0 与 Caffeine 的 L1 命中时请求到不了服务

所以走 Redis 缓冲：`INCR view:post:{id}` + `SADD view:dirty {id}`，每 60 秒
用 `getAndDelete` 取出增量回写。用 SET 记脏 id 而不是 `SCAN`（生产 Redis 上危险）；
用 `getAndDelete` 而不是 `GET` 再 `DEL`（后者会丢并发增量）。

写库失败或 Redis 挂掉丢一批——**这就是"不要求精确"的含义**，也是它敢这么做的原因。

分享反而直接 UPDATE：低频动作，没有浏览那种热点写问题。**不为统一而统一。**

#### 一个静默失败的配置前缀

写成了 `spring.redis`，而 Spring Boot 3 已把它移到 `spring.data.redis`。
**旧前缀不会报错，是被静默忽略的**——客户端回落到 `localhost:6379`，
直到第一次使用才报 `Unable to connect to Redis`。

更麻烦的是：浏览量计数是**显式降级**的（失败只记 WARN），所以页面照常工作、
帖子照常打开，只有 `viewCount` 一直是 0。这类"配置写错但功能看起来正常"
的问题，靠看页面发现不了，只能靠盯着那个数字。

#### `last_interaction_at` 只在更晚时更新

```sql
UPDATE t_post SET last_interaction_at = ?
WHERE id = ? AND (last_interaction_at IS NULL OR last_interaction_at < ?)
```

并发下两个事件可能乱序到达，不加条件会把时间往回拨，让帖子凭空"变旧"。

点赞的是**评论**时，时间要记到它所属的**帖子**上（热度对帖子算）——
多一次 SELECT，可以接受。任何失败只记 WARN：**计数投影已经成功了**，
不能让这一列拖累整条事件重投，否则计数会被重复加上去。

### P4.4 系统消息 + 折叠 + 验收（已完成）

| 件 | 位置 |
|---|---|
| `UserBanned` 事件 | common |
| user-service 接入 outbox | V3 迁移 + `kuaikan.outbox.enabled` |
| `t_message` 的 SYSTEM | `MessageService.onUserBanned` |
| 连赞折叠 | 前端 `foldMessages` |
| `verify-p4.sh` | **43 条断言**，L1~L6 |

#### outbox 抽成公共模块的判断在这里兑现

user-service 是第三个接入方。接入只需要：加依赖 + 建表 + 一行配置，
不需要再复制一遍 relay。这是 P4.0 那次抽取的全部收益。

#### 一个"什么都没发生"的故障

user-service 接入后，封禁接口返回成功、outbox 行正常写入，
**但事件一直躺在 `t_outbox` 里发不出去**——因为 user-service 的启动类没有
`@EnableScheduling`，relay 的 `@Scheduled` 从不执行。而所有日志都正常。

修法不是给它补注解，而是**把 `@EnableScheduling` 放进 `OutboxAutoConfiguration`**——
让接入方不可能再漏掉。`@EnableScheduling` 重复声明是安全的。

**这类故障最难查**：没有任何错误，只有"什么都没发生"。发现它靠的是
直接查 `t_outbox.status=0` 的行数，而不是看日志。

#### 封禁消息读不到，这是刻意的

封禁会同时踢下线并拒绝登录，所以用户在被封期间看不到 SYSTEM 消息。
它实际上是**解封后可读的审计记录**：把封禁原因写成用户可见的记录，
比只留在运维日志里更负责任。

#### 折叠只在展示层

相邻的、同类型 + 同目标的消息合成一条「林间 等 3 人 赞了你的《…》」。
存储不折叠（不变量 9）：每次点赞都是独立的事实。

**只折叠相邻的**——跨页或中间夹了别的消息就不合并。这是一条刻意保守的规则：
为了合并而重排顺序，会让"最新在上"变得不可信。
**只在 LIKE 上折叠**：评论与 @ 每条都带着不同的话，合并了就丢了信息。

#### 两个只在全量跑时才暴露的测试问题

| 问题 | 成因 |
|---|---|
| L4「单条已读后未读归零」单层跑过、全量跑红 | 各层共用同一套夹具（`FIXTURE_READY` 是全局的），L3 结束时留下未读。修法：L4 开头先 `read-all` |
| L6 的 p05/p1 红 | `AsyncRequestNotUsableException`（SSE 客户端断开）被当成未预期异常记 ERROR，打红了 P0 的「无 ERROR」断言 |

第二条是**产品问题不是测试问题**：客户端断连不是错误。它污染日志，
并且会把 P0 那条抓真问题的断言占死。已在 `GlobalExceptionHandler` 里单独忽略。

### P4.3 「评论 / @」的消息（已完成）

| 件 | 位置 |
|---|---|
| `CommentCreated` 补 `actorId` | common（**契约缺口，见下**） |
| `CommentEventConsumerRunner` | 组名 `kuaikan-notification-comment-consumer` |
| `MessageService.onCommentCreated` | 接收人计算 + 合并 + 批量落库 |
| `init-topics.sh` | 加 `kuaikan_comment_created` |

#### 契约缺口：`CommentCreated` 当初漏了 `actorId`

P4.1 定义这个载荷时只写了"谁该收到"，没写"谁干的"。消费者因此既不知道
消息里该显示谁，也没法做自抑制（自己评论自己的帖子不该给自己发消息）。

**这是设计时的遗漏，不是后来追加的功能。** 教训：事件载荷里
"动作发起人"和"动作对象"一样是必需项，少一个就要靠额外查询补。

修完之后有个真实后果：**P4.3 上线前发出的旧事件里没有 `actorId`**，
被 `CONSUME_FROM_FIRST_OFFSET` 重放时 actor 解析成 null，
消息显示成"已注销用户"。这印证了不变量 13 的用意——
破坏性变更本该换新 topic 名并双写过渡，我这次是直接改了同一个 topic。

#### 合并规则：同一接收人只一条，COMMENT 优先

| 接收人 | 类型 |
|---|---|
| 帖子作者 | COMMENT |
| 被回复者 | COMMENT（`putIfAbsent`，不会覆盖帖子作者的 COMMENT） |
| 正文里 @ 到的人 | MENTION（同样 `putIfAbsent`） |

实测："林间在小满的帖子下评论并 @ 小满" → 小满只收到**一条 COMMENT**，
`mention` 计数不变。这条规则让 `uk_user_event` 两列就够用；
若允许一人多条，唯一键就得加 `type`，约束也就弱了。

#### 评论消息指向帖子而不是评论

点进去要落到那条帖子的评论区，而不是某个孤立评论——
按 commentId 跳转需要一个"锚点滚动"能力，P4 不做。

### P4.2 「赞」全链路（已完成）

从 interaction 发事件 → MQ → notification 落库 → SSE → 前端红点，一次打通。

| 件 | 位置 |
|---|---|
| `t_message`（V1） | notification schema |
| `InteractionEventConsumerRunner` | 组名 `kuaikan-notification-interaction-consumer` |
| `SnapshotService` | 拉 actor 昵称头像 + target 标题摘录 |
| 读接口 | `/messages`（游标）/ `/unread`（一条 GROUP BY）/ `/read-all` |
| `/stream` | SSE，**提示通道**不做可靠投递 |
| 前端 | 抽屉接真数据、红点、全部已读、fetch 流客户端 |

#### 今天被同一个东西坑了两次：`StripPrefix=2`

网关给每个服务都配了 `StripPrefix=2`，`/api/<service>` 那一层在网关就被剥掉。

| 场景 | 错的写法 | 后果 |
|---|---|---|
| Feign 客户端路径 | `/api/user/users` | 500 + `NoResourceFoundException` |
| controller 类路径 | `@RequestMapping("/api/notification")` | 所有端点静默 404 |

方向相反，结果是同一个 500。规矩：**服务内看到的路径都是剥完之后的**
（content 的 `/posts`、community 的 `/communities`、notification 的 `/messages`）。

#### `X-Token-Exp`：网关新增的第二个注入头

SSE 连接建立后网关不再验签，连接可以活得比 token 更久，于是会留下
"还连着但已经无主"的连接。让 notification 自己解析 JWT 是更差的选择——
那等于开了第二个验签点（违反 ADR 0003）。所以由网关注入过期时刻，
服务端到点发 `event: expired` 再断流。

#### 三个容易写错的地方

**① 消费组名必须不同。** RocketMQ 里 topic 决定"哪些消息"、group 决定"我是谁"。
同一个 group 订阅同一个 topic 是**集群消费（各拿一半）**，不是广播，**而且不报错**。

**② 快照失败必须分类。** 用户/内容已删 = 不可重试（降级成"已注销用户"）；
连接失败/5xx = 重投。不分类的后果：一个被删用户让事件**永远重投**，堵住消费线程。
（实测踩到了：路径写错时 user-service 一直 500，消费组瞬间堆积上百条重试。）

**③ 推送必须在事务提交之后。** 在事务里推，一旦回滚就是"红点亮了但消息不存在"。
用 `registerSynchronization().afterCommit()`。

#### `CONSUME_FROM_FIRST_OFFSET` 的副作用

新消费组第一次启动会从最早的消息开始读。上线时这是对的（通知服务没跑期间的
互动不该被跳过），但本地会一次性重放全部历史事件——实测回填 128 条。

**点赞 → 取消 → 再点赞会产生两条消息**，这是设计如此（那是两次事实，
折叠是展示层的事，P4.4 做）。测试时反复点击会看到重复条目，不是 bug。

### P4.1 @ 提及（已完成）

评论正文里的 `@昵称` 解析成 userId，并在**已发出的评论**里渲染成蓝色可点链接。

| 件 | 位置 |
|---|---|
| `GET /internal/users/by-nicknames?names=` | user-service（**内部端点**） |
| `MentionResolver` | content（正则抽候选 → 昵称反查 → 逐个校验社群成员） |
| `t_comment.mentions` JSON 列 | content V5 |
| `MentionText` + `/u/:userId` 占位页 | web |

#### 三个关键判断

**① @ 解析全程「尽力而为」**

任何一步失败（user 挂了、community 超时、序列化失败）都只记 WARN 并返回空列表，
**绝不让评论发不出去**。理由同 ADR 0009：评论能不能发出去，比 @ 准不准重要得多。

**② `mentions` 必须落库，不能只进事件**

事件只需要"通知谁"，而**读评论的人需要知道哪几个 @ 是可点的**。不落库就得让每个读者
重新解析，还会因为后来的改名/退社得出不同结论。

存的元素是 `{id, nickname}`——**带昵称快照**。正文里写的就是当时的名字；
对方改名后用当前昵称去匹配会落空，`@旧名` 会退化成死文字。

**③ 事务边界收窄到只剩本地 SQL**

`@` 解析要 1+N 次远程调用。原来它写在 `@Transactional` 里，会让数据库连接横跨
这些调用（每次 500ms 超时），并发一上来就耗光连接池。

改成 `TransactionTemplate` **显式**框住写入段——注意不能把 `@Transactional` 挪到本类的
另一个方法上：**同类自调用不走代理，注解会静默失效**，事务根本没开。

#### 「楼主」标记

评论区与回复里，帖子作者自己的评论会带一个浅灰「楼主」小标。

- 用模块内 context 传递 `postAuthorId`，不逐层传参：`CommentSection` → `TopLevelComment`
  → `ReplyList` → `ReplyItem` 四层，多一个参数会把每层签名挤满
- **浅灰不是蓝色**：蓝色在本项目里只表示"可点"，楼主标不可点
- `useContext` 必须在顶层无条件调用——写在 `&&` 右边会因为短路被跳过，
  渲染次数一变 hooks 顺序就变（`rules-of-hooks` 直接抓到了）

#### 已知限制

- **昵称带空格或标点时无法被 @**。昵称只校验了长度（2~32），没有字符集限制；而解析必须
  先靠正则找出候选边界，正则不可能在不知道完整昵称表的情况下判断"名字在哪结束"。
  `@张 三` 会被截成 `张`，匹配不到人，退化为普通文字。为了极少数带空格的昵称在评论
  写路径上多一次批量查询，不值得。
- **重名取 userId 最小的那个**。昵称没有唯一约束，这条是已定的规则，不是随机行为。
- **Markdown 代码块里的 `@` 也会被识别**。正文是纯文本，不做语法感知，已知取舍。

### P4.0 outbox 抽取（已完成）

P4 要让 content 发 `CommentCreated`，而 content 之前**一行 MQ 生产代码都没有**。
把 interaction 里跑通的 outbox 抽成 `services/kuaikan-common-outbox`，两个服务共用。

**为什么抽而不是复制**：这份代码的正确性全靠细节——`eventId` 必须与业务写入
同事务生成（重投时不变，是幂等的前提）、`payload` 是序列化快照投递时不回查业务表、
1s 轮询、指数退避、20 次放弃、原生 `rocketmq-client` 而非 starter
（starter 把"发消息"变成立即调用，而 outbox 要的是由轮询决定时机）。
复制第二份的那天起两边就会开始不一样。

三个刻意的设计选择：

| 选择 | 理由 |
|---|---|
| `kuaikan.outbox.enabled` **默认 false** | 不开只是不发事件；误开的代价是每秒扫一张不存在的表，日志刷屏还掩盖真错误 |
| namesrv 不在 `OutboxProperties` 里 | 统一取 `kuaikan.mq.namesrv-addr`，放两份就会出现"改了一个不生效"。`relay-interval` 同理，由 `@Scheduled` 直接读 Environment |
| **不在 auto-config 里替使用者做 Mapper 扫描** | `@MapperScan` 一旦出现就会关掉 MyBatis-Plus 的自动扫描（它带 `@ConditionalOnMissingBean(MapperScannerConfigurer.class)`），所以必须由服务自己显式列出两个包。漏了会在启动期报 `NoSuchBeanDefinition`，失败是响亮的；替使用者做反而把这条依赖关系变成隐式的 |

**每个服务在自己的 schema 里建自己的 `t_outbox`**（content 是 V4），
模块只给代码不给迁移脚本——outbox 必须与业务数据同库同事务，共用一张表就回到共享数据库了。

实测：评论一篇帖子 → `content.t_outbox` 出现 `status=0` 的行 → 几秒后 `status=1`；
点赞/取消赞的计数投影仍正常（重构没改行为，表结构、topic、事件载荷一个字没动）。

### 脚本基础设施：`check-scripts.mjs`

`$VAR` 后面紧跟中文时，macOS 的 bash 3.2 会把中文字节吞进变量名
（报 `USER_ID2：(unbound variable)`）。这个坑踩了三次——`verify-p1` 的 `USER_ID2`、
`verify.sh` 的 `expect_id`、`verify-p2` 的 `$a`——所以做成了会红的检查：

```
deploy/bin/check-scripts.mjs   →  verify-p2.sh 的 L1 调用
```

检查三条：`$VAR` 后紧跟非 ASCII 处必须写 `${VAR}`、必须 `set -u`、shebang 统一。

### 验收脚本的两条纪律

**① 破坏性层必须最后跑。** `verify-p2.sh` 的执行顺序是 L1 → L2 → L3 → L5 → L4。
L4 会真的 stop 服务，被 kill 过的服务之后 10 分钟内持续写 ERROR，
而 P0 有一条"近 10 分钟无 ERROR"的断言——先破坏再回归 = 让回归必然失败。

**② L4 停掉的服务必须有兜底重启。** 用 `COMMUNITY_STOPPED` 标记，
在 `trap cleanup EXIT` 里无条件拉起。曾经因为脚本在中途报错退出，
community-service 被留在停止状态——**一个能把环境停掉的验收脚本，比没有验收脚本更糟**。

配套地，`verify.sh` 增加了显式的 `--skip-log-check`（只有 verify-p2 的 L5 用）。
用开关而不是往 `NOISE` 正则里加例外：后者会把真正的回归一起放过。

### 视觉与信息架构（P3 之后的打磨）

打样见 [`design/proto/app.html`](./design/proto/app.html)（自包含，可直接打开）。
实现过程中沉淀了四条规矩。

#### 令牌集中在 `web/src/styles/index.css`

7 档字号 / 4 档圆角 / 3 档阴影 / 3 档动效时长 + 一条缓动。
**字号不许超过 7 档**——想用第 8 种，说明层级设计有问题。

**正文字体是系统无衬线，不是等宽。** 之前 body 用的是
`ui-monospace, …, PingFang SC, monospace`，用它排中文正文是最伤阅读体验的一条。

#### 分区靠 1px hairline + 留白，不靠卡片

产品页面（帖子详情、社群概览、我的、登录、发帖、建社群）全部去掉了 `Card`。
卡片多了立刻显廉价，而 hairline + 留白能同时做到"有分区"和"不抢注意力"。
`/test` 诊断台仍然用卡片——那是仪表盘，不是产品页。

#### 信息的可达性决定它放在哪

| 位置 | 放什么 | 理由 |
|---|---|---|
| 顶栏主导航 | 首页 / 社群 / 关注 / 热榜 / 搜索 | 需要"随时可达"的场景切换 |
| 顶栏右侧 | 消息（带未读数）、头像昵称 | 需要随时看一眼的状态 |
| 点击昵称 | 我的 | **不占顶栏**：顶栏是最贵的位置，我的不是高频入口 |
| 底部 tab（窄屏） | 五个主导航 | 390px 放不下五个横排，而横向滚动条一律不要 |

#### 搜素是全屏层、消息是抽屉

- 搜索是**瞬时任务**，不该丢掉当前上下文 → 全屏覆盖层
- 消息是**读帖子时的旁支** → 右侧抽屉，四分类 tab
- 社群切换是**高频的"找并点"** → 底部弹窗 + 2 列大卡片
  （下拉菜单一行放不下头像/成员数，社群多了要滑很久还容易误触）

#### 正文渲染 Markdown 的安全边界

第一版正文是纯文本 + `whitespace-pre-wrap`，注释里写的理由是
「引入解析器 + 消毒是全新的 XSS 面」。顾虑成立，但结论错了。

用 `react-markdown` + `remark-gfm`，**不启用 `rehype-raw`**：
默认把 HTML 当纯文本，`<script>` / `<img onerror>` 不会变成 DOM 节点。
所以"不做 Markdown"和"引入 XSS 面"之间没有必然联系——**是 `rehype-raw` 引入的，不是 Markdown 引入的**。

真正的风险变成了「后来有人觉得 HTML 支持挺方便，加上 rehype-raw」。
这条禁令写在组件注释里。真需要 HTML 时必须配 `rehype-sanitize` 并重新评估白名单。

#### 示例数据（`deploy/bin/seed-demo.sh`）

冷启动时只有 1 个社群 2 篇帖子，界面看起来"空得没做完"——**没法判断排版密度、
列表节奏、评论区层级是否成立**。所以有一批示例数据：

| 项 | 内容 |
|---|---|
| 账号 | `demo+{linjian,xiaoman,kevin,acha,laobai}@kuaikan.test` / `DemoPassw0rd!` |
| 社群 | 前端周刊 / Rust 中文 / 摄影与器材 / 厨房实验 / TypeScript 中文 |
| 内容 | 16 篇帖子（每篇 2~4 段真实内容）、49 条评论（含楼中楼）、63 次点赞与收藏 |

**必须走真实接口写入，不能直插数据库**：否则计数投影、outbox、事件消费整条链路
都没有被跑过，示例数据的计数会是错的，反而掩盖问题。

**时间戳事后回填**：社群 30~40 天前，帖子按 id 顺序每篇往前推 7 小时（覆盖约 5 天），
评论落在自己帖子之后 35~125 分钟。不回填的话所有内容都是"刚刚"，
列表看起来像刚灌进去的。

**造数据时要遵守真实规则**：第一版有 4 条 `41004`，因为让非成员去评论、去发帖。
规则是对的，改数据不改规则。

`--clean` 一条命令删干净（按社群名 + `demo+%` 邮箱前缀），不影响真实内容。

#### 一处必须靠"同视角截图对比"才能发现的差距

第一版实现上线后，观感与打样**完全是两个物种**。原因是布局外壳，不是字体：

| 项 | 打样 | 第一版实现 |
|---|---|---|
| 容器 | 1200px 居中 | 贴左、无限宽 → 右栏内容被推到很右，两栏之间空一大块 |
| 外壳 | 无边框 | 还留着 `rounded-lg border`（卡片残留） |
| 高度 | `calc(100vh - 顶栏)` | 写死 `7rem` 的估算值 |
| 左栏分组 | 「选择社群」「帖子」两个小标题 | 换 switcher 时丢了 → 只剩"一个下拉框 + 一堆文字" |
| 正文栏宽 | 640px | **552px**（padding 写在了 `max-w` 的盒子里边） |

**教训：视觉验收要拿同视角截图并排看，不能只靠"读代码觉得对"。**
这五处问题 typecheck / lint / build / e2e 全绿——它们只验证行为，不验证长相。

#### 三个只有真跑浏览器才能发现的坑

**① `text-background` 这个类 Tailwind 根本没生成。**
`--text-*` 是字号命名空间，与颜色 `--color-background` 撞了，Tailwind 丢弃了它。
改用 `text-white`。

**② twMerge 把自定义字号当成颜色组，静默删掉 `text-white`。**
`bg-foreground text-white … text-aux` 这串类里，twMerge 不认识 `text-aux`
（我们自定义的档位），把它归到颜色组 → 与 `text-white` 冲突 → 后者胜出
→ 白色文字被删除 → **黑底黑字，而 typecheck / lint / build 全绿**。
修法是在 `shared/lib/cn.ts` 用 `extendTailwindMerge` 注册那 7 个档位。

**③ 底部弹窗在 1280 宽下横跨整屏**，看起来像横幅而不是卡片。限宽 40rem 居中。

#### 没有素材也要有视觉重量

我们没有插画和产品图，所以视觉重量由**排版、留白、以及内容本身**承担。
头像没有图时用柔和渐变 + 首字（而不是灰圆点）——列表里的色块节奏是唯一的"装饰"。

### P3.2 点赞 + 收藏（已完成）

interaction-service 从零建起数据层，`t_interaction` + `t_outbox`；
content 侧 `t_consume_log` + 消费投影 + 对账。

#### 取消点赞是**物理删**，和加入社群的软删相反

```
加入社群：软删 —— 唯一键要表达"退出过"，member_count 的增减靠状态判断
点赞：  物理删 —— 接口语义是"设为已赞/未赞"，"没有这一行"就是唯一的事实
```

**接口语义是「设为某状态」而不是「翻转」**，这是幂等的根本：

| 操作 | SQL | affectedRows | 是否产生事件 |
|---|---|---|---|
| 首次点赞 | `INSERT IGNORE` | 1 | 发 ADDED |
| 重复点赞 | `INSERT IGNORE` | 0 | **不发** |
| 取消（赞过） | `DELETE` | 1 | 发 REMOVED |
| 取消（没赞过） | `DELETE` | 0 | **不发** |

重复点赞因此**根本不产生第二个事件**，消费侧连去重都不需要。

#### outbox 在事务内写，发 MQ 由轮询负责

```
✅ 同一个本地事务：写 t_interaction + 写 t_outbox
   → 事务提交 = 事件一定被记住
   → OutboxRelay 每秒轮询投递，失败指数退避，重试 20 次后放弃
```

**不做"提交后立即发"**：那要两套代码路径（立即发 + 轮询兜底），而轮询最坏延迟 1 秒，
远小于计数允许的 5 秒滞后。一条路径、可测、进程崩溃也不丢。

重试上限 + 对账兜底才构成完整答案——放弃之后事件就真丢了，只有对账能修。

#### 对账必须由 content 发起、向 interaction 要真值

第一版我写的是"content 直接 `UPDATE ... JOIN t_interaction`"——**做不到**：
ADR 0006 规定一库一账号，content 对 interaction 的库没有任何权限。

改成：

```
content 遍历自己的全部帖子/评论（按 id 游标分页）
  → GET /internal/counts?targets=post:1,comment:2   （interaction 提供真值）
  → 覆盖写 like_count / favorite_count
```

**必须遍历自己全部的目标**，不能只问"有互动的那些"——`GROUP BY` 天然不返回计数为 0 的目标，
而"点赞全取消后计数卡在旧值"恰恰是最常见、也最需要修的情况。

#### 点赞**依赖** content 的目标校验（方案 A）

早期笔记里写过"点赞不依赖 content 的可用性"，**那是错的**。点赞前要问
`/internal/targets`"这个目标存在吗、作者是谁"：不校验就会给不存在的目标写垃圾事实
（对账也无从清理），而事件载荷里的 `targetOwnerId`（P4 的通知需要）只有 content 知道。

代价是 content 挂掉时全站点不了赞。这是有意的取舍——那时站点主要功能本来也不可用了。

L4 因此断言的是**失败必须明确且快速**（`50300`、5 秒内返回），不是 500、不是挂住。

#### topic 必须在服务启动之前就存在

实测：消费者在 topic 存在之前订阅，**之后不会自己拿到路由**。interaction 发出第一条事件时
broker 自动创建了 topic，但先启动的 content 消费者一直没消费，重启后才把积压的消息读走。

第一次上线时这就是"点赞了但计数永远不动"，而且所有接口都返回成功，从外面看不出问题。
所以有了 `deploy/bin/init-topics.sh`（幂等 `updateTopic`），**topic 列表要与 `Topics.java` 同步**。

#### 三层幂等，各有各的位置

| 层 | 位置 | 挡什么 |
|---|---|---|
| 唯一键 + affectedRows | interaction 写事实 | 重复点赞（连事件都不产生） |
| `t_consume_log(event_id, consumer)` | content 消费 | 重复投递（MQ 是 at-least-once，这是必然事件） |
| 对账 | content 定时任务 | 事件被放弃、消费逻辑 bug、手工改库 |

**去重记录与计数更新必须同事务**：先改计数再记日志，中间崩溃重投会 +2。

### P3.1 评论（已完成）

`t_comment`（Flyway V2）+ `ALTER t_post` 补三个计数列、发评论、一级列表、回复列表、
删除自己的评论、前端评论区。

#### 三个"回复"字段连起来是一句话

```
root_comment_id / reply_to_comment_id / reply_to_user_id
→ 属于哪个主楼、回复的是哪条评论、回复给谁
```

**叫 `reply_to_comment_id` 而不是 `parent_id`**：`parent_id` 描述结构（树里的父节点），
而我们的展示是**两级平铺**——C 回复 B，但 UI 上 C 和 B 平级。叫 `parent_id` 会让
人第一反应写递归渲染，而正确做法是按 `root_comment_id` 一次查平。**名字在诱导错误的实现。**

#### `reply_count` 是后代总数，不是直接子节点数

architecture §7 原文写的是"直接子节点数"。但两级平铺下，用户看到的
"展开 N 条回复"里的 N 必须等于展开后出现的条数：

```
A 有直接回复 B、C，B 下面还有 D
直接子节点数 = 2 → 显示"展开 2 条"但展开后有 3 条   ✗
后代总数    = 3 → 显示与内容一致                    ✓
```

由此 `post.comment_count` 也自洽：`Σ(一级评论的 reply_count) + 一级评论数 = comment_count`。

#### tombstone 不是一律软删

| 情况 | 做法 |
|---|---|
| 有回复的评论被删 | 软删（`status=0`、`body=''`），保留行——否则子回复的 `root_comment_id` 变孤儿 |
| 没有回复的评论被删 | **物理删**——留一行"该评论已删除"的空壳没有意义 |

由此守住一条不变量：**`status=0` 的评论一定有回复**。于是列表查询完全不用过滤 `status`，
索引也不必带它。

**连带清理**：删掉最后一条回复时，若主楼是 tombstone 且已无回复，主楼一并物理删除。
不加这一步，不变量会被破坏，列表里会冒出空壳。

#### 权限

| 操作 | 规则 |
|---|---|
| 看评论 | 游客可读 |
| 发评论 / 回复 | **必须是社群成员**（`41004`），复用 P2.3 的 `/internal/memberships` |
| 删除评论 | **只能删自己的**（别人删 → `40300`） |

回复还校验"父评论属于同一个帖子"——否则用 A 帖的评论 id 往 B 帖插回复，
`root_comment_id` 会跨帖，列表查询就串了。

#### 网关配置改了要重建镜像

`application.yml` 是打进镜像的。P3.0 加了评论区的两条放行正则后，**没有重建网关镜像**，
于是 `GET /posts/{id}/comments` 一直 401——而 `check-openapi` 是绿的（它读文件，不读运行态）。

**改动网关配置后必须 `docker compose up -d --build gateway`。** 这类"检查绿、运行红"的
组合最容易误判成业务 bug。

### P3.0 契约闸门（已完成）

P3.0 **只冻结契约，不建表、不写端点**。设计见 [`design/p3-interaction.md`](./design/p3-interaction.md)，
计数一致性的取舍见 [ADR 0010](./adr/0010-count-consistency.md)。

#### 事件契约里两处容易被忽略的细节

**① 载荷里的 id 一律用 `String`。** web 层的 `JacksonConfig` 把 `Long` 序列化成字符串，
但 **MQ 序列化用的是 RocketMQ 自带的 ObjectMapper，不受那个配置影响**。
同一个 `Long` 在两处序列化成不同类型，而消费端反序列化失败是**运行时**才暴露的。
用 `String` 让载荷与序列化配置无关。

**② `targetOwnerId` 现在就要带上。** content 侧的计数用不到它，
但 P4 的"有人赞了你"需要。事件不可变，现在不带以后就只能换 topic。

#### 点赞与收藏共用一个 topic

`kuaikan_interaction_changed`，靠载荷里的 `kind` 与 `change` 区分四种情况。

理由：它们的**消费边界相同**（content 两者都消费，notification 只消费 `LIKE+ADDED`）。
拆成四个 topic 只会让消费方多订阅几份，几乎没有收益。

#### 评论事件 P3 不发

评论数在 content 的本地事务里就算完了，P3 没有任何消费者。
等 P4 真正需要（通知）、P6 需要（索引）时再冻结那个契约——
不为没人消费的东西先写规格。

#### P3 的计数一致性边界

| 计数 | 一致性 | 为什么 |
|---|---|---|
| 评论数 / 回复数 / 成员数 | **强一致** | 事实与计数同库，同一本地事务 |
| 点赞数 / 收藏数 | **最终一致 ≤5s** | 强一致只能靠 interaction 同步调 content，而 content 挂掉时全站点不了赞 |

对账不是独立阶段，它是 P3.2 完成定义的一部分：没有对账，一次丢事件就是永久错误。

### P2.4 读路径与双栏（已完成）

`GET /api/content/posts?communityId=&sort=new&cursor=&limit=`，以及前端的双栏布局。

#### 游标分页的正确性靠什么

```sql
WHERE community_id = ? AND status = 1
  AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT ?
```

- **行值比较**而不是 `created_at < ? OR (created_at = ? AND id < ?)`：前者能直接走
  `idx_community_created`，后者在优化器眼里是不等值组合，容易退化成额外排序
- **复合键**：单列 `created_at` 在并发发帖撞同一毫秒时会重复或跳过
- **多取一条**（`limit + 1`）判断有没有下一页，省掉一次 count

`verify-p2.sh` 有一条专造这个场景的断言：发 25 帖 → 拉第一页 → **中途再插 3 帖** →
用第一页的游标拉第二页 → 断言与第一页零重复。offset 分页在这里必然重复。

#### 每个列表的游标排序标记必须不同

`community-new`（社群列表）/ `post-new`（帖子列表）/ `mine`（我加入的社群）。

共用标记的话，把一个列表的游标喂给另一个列表会被**静默解析**成错误结果。
分开之后跨列表复用会明确返回 `40010 游标与排序方式不匹配`，有断言守着。

#### `sort` 只实现 `new`，其他值明确拒绝

`sort=hot` 返回 `40010` 而不是静默降级。静默降级会把 bug 藏起来——
P5 上线热度排序时无法证明它真的生效了。

#### 双栏：URL 才是状态

`/c/:name` 是 layout route：`index` → 社群概览（右栏空态），`p/:postId` → 帖子正文。

右栏内容由**路由**决定，不用 `useState`。否则失去分享链接、后退键、刷新保持、
`cmd+click` 开新标签。

- 左栏 320px，右栏自适应；两栏各自滚动，页面本身不滚
- 高度写的是 `calc(100vh - 7rem)`——那是 header + main 内边距的**估算值**，
  改头部高度时要跟着改（算多了多一条细滚动条，算少了列表底部被切掉，两种都能一眼看出来）
- **窄屏（<768px）只显示一栏**，按 index/详情切换显示哪栏。路由不变

#### 社群切换器拆成两个东西

| 需求 | 形态 |
|---|---|
| 我加入的社群（少量、高频切换） | 常驻列表 |
| 全量社群（搜索定位） | 可搜索下拉 |

不用横向滚动条：不可发现、不可扩展、无障碍差。

#### 加载更多必须用 useInfiniteQuery

原来手写"游标数组 + 多次 useQuery"，每页是一个独立 query，`data` 只包含**最后一页**
——于是加载更多把 20 条**替换**成了第 2 页的 5 条。

**这个 bug 是 L3 浏览器验收抓到的**（滚到底后条数从 20 掉到 5），
HTTP 层的分页断言完全看不出来。这是"L3 只测必须用浏览器才能验的东西"的正面例子。

#### L4 收尾要清掉自己的日志噪音

L4 故意停服务，被影响的三个容器必然写 ERROR；而 P0 有一条"近 10 分钟无 ERROR"
的断言，于是**紧接着的下一次验收必然失败**，哪怕只跑 P0.5。

现在 L4 收尾时 `truncate -s 0` 掉它影响到的三个容器的日志。
清掉自己的痕迹是 L4 的责任——否则每一次连跑都会因为上一轮的故意破坏而失败，
那种红最难排查。

### P2.3 发帖（已完成）

`POST /api/content/posts`、`GET /api/content/posts/{id}`、
`GET /internal/memberships`（community）、`GET /api/user/users?ids=`（user）。

#### t_post 里没有的东西比有的更重要

| 没有 | 理由 |
|---|---|
| 作者昵称/头像 | 存快照会让**发帖依赖 user-service 的同步可用性**（ADR 0009） |
| 计数列 | P2 没有写入者；口径（comment_count 含不含 tombstone？）要 P3 才定 |
| slug | 标题会变、会重复、会很长；帖子用 id 做 URL |

也**不做 `view_count`**：最容易被刷的计数，又必须配一套对账，收益远小于维护成本。

#### 发帖是唯一依赖 community-service 的写路径

```
content-service 发帖前 → GET /internal/memberships?communityId=&userId=
```

身份**显式传参**（ADR 0008），超时 500ms，失败一律 `50300`，**不重试**——重试会把
500ms 变成 1.5s，而后端不可用时重试收益为零、代价是多占两倍线程。

内部接口用 `{exists, member, role}` 正常返回表达两种"不满足"，**不用异常跨服务传错误码**。
它回答的是"是什么"，不是"做什么"，所以总是成功返回。

`kill community-service` 的实测结果：发帖 `50300` 且 **1 秒内返回**，同时读帖子详情仍 `200`。
这条对照就是 ADR 0009 边界的证明，已写进 `verify-p2.sh` 的 L4。

#### 批量作者摘要：新开的公网可见面

`GET /api/user/users?ids=1,2,3`，游客可读。三条约束写死在实现里：

1. **只返回 `userId` / `nickname` / `avatarUrl`** —— 不给 email（撞库）、
   不给 status（泄露封禁）、不给时间戳（推断注册/活跃）
2. **单次最多 100 个 id** —— 它长得像"用户目录"，不设上限等于开放拖库
3. **不存在的 id 直接不返回**，调用方降级成"已注销用户"

#### operationId 必须显式命名

community 与 content 都有 `create` / `detail` → 前端 `typed.ts` 交叉合并后**静默指向
其中一个**（两个形状兼容时 TypeScript 照常编译通过）。已全部改成自带领域前缀的名字：
`listCommunities` / `createCommunity` / `getCommunity` / `joinCommunity` /
`leaveCommunity` / `listMyCommunities` / `getMembership` / `createPost` / `getPost` /
`batchUserSummaries`。

**新增端点必须显式写 `@Operation(operationId = ...)`**，不靠方法名兜底。

#### `check-openapi.mjs` 的模板路径问题

它原来拿 spec 的**模板路径**（`/posts/{postId}`）去匹配网关正则，于是
`^/api/content/posts/[0-9]+$` 这种"只认数字 id"的精确规则永远判为不覆盖——
而我们刻意写得最严的恰恰是这种。

改成先把模板参数替换成代表性取值（数字 / 字母 / 连字符）再匹配。
这是启发式：拦的是"忘了加条目 / 方法写错"，不是证明正则等价。

### P2.2 加入社群（已完成）

`POST|DELETE /api/community/communities/{name}/membership`（都幂等）、`GET /mine`。

#### member_count 的三条规矩

1. **唯一写入者是 community-service，与成员行同一本地事务**，不跨服务不发事件。
2. **只用相对更新**：`UPDATE ... SET member_count = member_count + 1`。先读再写在
   并发下会丢更新（两个请求都读到 5、都写 6，实际加进来 2 个人）。
3. **要不要 ±1 由 affectedRows 决定**，不是"成功就加"。

#### 成员变更事务先锁社群行（否则并发死锁）

加入流程是"改成员行 + 改 member_count"两条语句，第一步是 insert 成员行。
若该行已存在，insert 因唯一键失败，**InnoDB 会在失败的索引记录上留下共享锁**；
两个并发事务各持 S 锁、又都想升级成 X 锁 → 死锁。

现场：10 个并发加入报 `DeadlockLoserDataAccessException ... revive`。

解法不是加重试，而是**给所有成员变更事务一个统一的、最先获取的锁点**：
`select ... FOR UPDATE` 锁住社群行。同一社群的加入/退出被串行化，锁顺序固定
就不会成环。加入是低频操作，串行化的代价可以忽略。

#### 加入：insert 优先，撞唯一键就复活

```
insert 成功                      → +1（新成员）
DuplicateKeyException → revive() → +1（原 status=0，复活）
                       revive()=0 →  0（本来就 active）
```

**没用一条 `ON DUPLICATE KEY UPDATE`。** 那条写法要求自己先分配雪花 id，
于是得注入 `IdentifierGenerator`——而它挂在 MyBatis-Plus 的 GlobalConfig 上，
不一定以 bean 暴露；更关键的是**自己生成 id 会绕开 compose 里按服务分配的
`ID_WORKER_ID`**，而 worker-id 冲突要等到写入时才暴露。

让 `BaseMapper.insert` 分配 id，等于沿用了服务级配置。并发仍由唯一键裁判：
两个请求同时加入，一个 insert 成功，另一个撞键后走 revive 返回 0，不重复计数。
`verify-p2.sh` 里有 10 并发加入只 +1 的断言。

#### 退出：只有 affected=1 才 -1

`UPDATE ... SET status=0 WHERE ... AND status=1`，返回 1 才是真的从"在社"变"已退出"。
重复退出返回 0，不扣计数。

#### 所有者不能退出（41005）

退出后会变成"不是成员的所有者"：不能发帖、社群也没人管。转让能力在 P7，
这是 P2 的已知缺口——中间这段时间只能由管理员改库。

#### /mine 放在 /mine 而不是 /communities/mine

社群名就是标识。如果有人把社群叫作 `mine`（或 `new`），
`/communities/mine` 会同时是"我的社群"和"那个社群"，只能靠路由优先级决定谁赢——
那是个没人会记得的陷阱。放在 `/mine` 之后，`/communities/{name}` 的命名空间就是干净的。

排序以**成员行的 joined_at** 为准（不是社群创建时间）："我刚加的"应该排在前面。
游标里存成员行 id，与社群列表的游标含义不同，所以两者的排序标记也不同。

#### 加入状态从 /mine 推导，不在详情里

公开详情没有 `viewer*` 字段（放行 = 匿名，见 P2.1）。所以前端用 `/mine` 判断
"加没加入"。**建社群后必须失效 `/mine` 缓存**——创建者同时也是第一个成员，
漏了会让刚建完的社群页显示"加入社群"（浏览器验收发现的）。

### P2.1 社群（已完成）

#### 社群名就是标识，没有 slug

```
name     = 展示名，用户输入原文（trim 后），创建后不可改
name_key = 规范化唯一键，系统生成：NFKC + trim + toLowerCase + 连续空白转 "-"
URL      = /c/{name_key}
```

用户只填名字和简介，其他什么都不用管。重名返回 `41002`。

**校验顺序是硬要求：先 NFKC 折叠，再校验字符集。** 如果先按 ASCII 校验原始名称，
全角输入（`ＡＢＣ`）会被 `40010` 拒掉，NFKC 就成了死代码。现在 `ＡＢＣ` 能建，
且与 `ABC` 视为同名——`verify-p2.sh` 有断言守着。

**社群名创建后不可改**：名字成了 URL，改名等于让所有旧链接失效。贴吧与 Reddit 同规则。

#### 所有者是社群的属性，管理员是成员的身份

| 概念 | 存在哪 | 数量 |
|---|---|---|
| 所有者 | `t_community.owner_id` | 每个社群恰好一个 |
| 管理员 | `t_community_member.role = 1` | 可多个（P7 才有写入者） |

不用 `role = OWNER`：MySQL 没有"每社群只能有一行 owner"的部分唯一索引，那份唯一性
只能靠应用层保证，而 `owner_id` 是单列，天然唯一。所有者也是成员（建社群时同一事务
插 member 行）。

#### 建社群 = 建社群 + 成为第一个成员

`t_community` 与 `t_community_member` 必须**同一刀引入**：没有成员表就表达不了创建者，
`member_count` 也对不上。三件事在同一个本地事务里。

#### 网关放行规则必须是 (方法, 路径)

这条是 P2.1 踩出来的。原来只按路径匹配，于是 `GET /communities`（公开）把
`POST /communities`（需要登录）也一起放行了——网关走"放行分支"、跳过身份注入，
下游 `requireUserId()` 抛 401。**症状是"带着 token 反而说没登录"**，极易误判成
token 问题。

现在规则格式是 `<METHOD> <路径或正则>`，方法位写 `*` 表示任意方法；格式错误
**在网关启动时抛异常**（一条写错的放行规则意味着某端点悄悄对全网开放，
必须部署时就炸）。`PublicEndpointRules` 负责解析与预编译。

P2.3 的 `/posts`（GET 公开 + POST 需要登录）会再验证一次这套机制。

#### 公开端点上一律匿名

网关的放行分支**永远剥离身份**，所以公开 endpoint 上 `UserContext.userId()` 恒为 null。
原打算在社群详情里带 `viewerJoined` 省一个请求，做不到；与其把网关改成
"公开路径吞掉验签失败"（多一条难测的分支），不如保持一条无例外的规则：
**放行 = 匿名，永远。**"我加没加入"由 P2.2 的 `/mine` 回答。

#### 三次踩到同一个坑：跨服务共用的 Web 设施必须在 common-web

| 设施 | 原本只在 | 后果 |
|---|---|---|
| `MybatisAuditHandler` | user-service | 新服务插入后实体上 `createdAt` 为 null |
| `GlobalExceptionHandler` | user-service | **所有 BizException 漏成 Spring 默认 500 页面**，前端拿不到 code |
| `JacksonConfig` / `OpenApiConfig` | 已在 common-web | — |

后两者现在都在 `kuaikan-common-web`，由 `WebAutoConfiguration` / 独立 AutoConfiguration
以 `@Bean` 注册（它们不在各服务的 `@ComponentScan` 包下，光有注解扫不到）。
**新增服务时先确认这三样是否已生效**，否则会以"静默失效"的方式重犯。

#### Jackson 只把包装类型 Long 转成字符串

新规矩：**`Long`（包装）= 可能是 ID → 字符串；`long`（原始）= 计数/时长 → 数字。**

一开始两者都转，于是 `memberCount`、`expiresIn` 在 JSON 里是 `"1"`，
而 OpenAPI 契约写 `integer` —— 生成的 TS 类型说 number、实际拿到 string，
前端任何算术都会静默出错。

#### 审计时间戳截到毫秒

库里是 `DATETIME(3)`，`LocalDateTime.now()` 带纳秒。不截断的话，
"创建接口返回的 `createdAt`"是 `...646746906`、"详情读回来的"是 `...647`，
同一个字段两种格式。

### P2.0 契约闸门（已完成）

P2 有 11 个端点、2 个新 schema、3 个服务同时改。P2.0 **不写任何业务代码**，
只把"事后改要返工一大片"的四样东西冻结，并让冻结**可执行**。

| 冻结项 | 改错的代价 |
|---|---|
| content 用 `communityId` 还是 `slug` | 决定有没有跨服务读依赖，改要动服务边界 |
| 游标形状 + 排序版本位 | 改要动 SQL、索引、前后端 |
| 错误码编号与 HTTP 映射 | 改要动三方（JSON / Java / 前端表）+ 已有断言 |
| operationId 跨服务命名 | 改会**静默**破坏前端类型 |

#### 错误码 15 → 19

`41001 COMMUNITY_NOT_FOUND`(404) / `41002 COMMUNITY_SLUG_TAKEN`(409) /
`41004 NOT_MEMBER`(200) / `42001 POST_NOT_FOUND`(404)。

**没有"已是成员"这个码**：加入/退出都设计成幂等成功，幂等用
`INSERT … ON DUPLICATE KEY UPDATE` + 判 `affectedRows`（与 P3 消费幂等同一手法）。

⚠️ `ErrorHttpStatus.SPECIAL` 必须用 `Map.ofEntries` 而不是 `Map.of`——
`Map.of` 的参数上限就是 **10 对**，P1 结束时正好 10 个，加两个会直接编译失败，
且报错信息指向不到原因。

#### `@PublicEndpoint` + 全局 `bearerAuth`

`kuaikan-common-web` 里的 `OpenApiConfig` 给所有服务统一声明 `bearerAuth` 作为全局安全要求，
被 `@PublicEndpoint` 标记的端点则显式清空成 `security: []`。

这样"哪些端点对游客开放"从**只在网关 YAML 里的一份手抄清单**，变成
**controller 上声明 + spec 里可见 + 脚本可比对**。没有全局 `bearerAuth` 时
`security: []` 毫无意义，白名单也就失去了可比对的对手。

springdoc 在 `kuaikan-common-web` 里是 `optional` 依赖 + `@ConditionalOnClass`，
不引入 springdoc 的服务（gateway）不会因此启动失败。

#### `check-openapi.mjs` 三条检查

| 检查 | 防的是什么 |
|---|---|
| operationId 跨服务唯一 | `typed.ts` 用交叉类型合并 7 个服务的 `operations`；同名会被合并成 `A & B`，两个形状兼容时 **TypeScript 照常编译通过**，类型却悄悄指到另一个服务 |
| `security: []` 端点 ⊆ 网关白名单 | 漏配白名单 = 游客拿到 401，且要等到浏览器验收才发现 |
| 白名单精确条目必须存在 | 防白名单腐化（端点改名/删除，白名单还留着） |

**上线第一天就抓到两个真实冲突**：`ping` 在 7 个服务里重名、`mqStatus` 在 2 个服务里重名。
已全部改成 `<service>Ping` / `<service>MqStatus` 形式。

三条检查都**验证过能红**（删白名单条目 → 报"公开端点未被覆盖"；加假条目 → 报"白名单已腐化"；制造 opId 冲突 → 报重复）。不能失败的断言不是断言。

通配白名单（`^/api/[^/]+/ping(/.*)?$`）不做存在性校验，但每次运行都**列出来**——
那是 P1 的已知债务，藏起来比列出来更糟。

#### 删除 frontend mock 基座

P1.0 起的 `web/src/shared/api/mock/`（221 行 + `__KUIKAN_API_MOCK__` define + 全局声明）已删除。

mock 的收益是**并行开发**（前端不等后端），而本项目是单人开发、后端只能跑在服务器上，
没有并行可言。成本则是维护第二套实现，P2 要再加 11 个端点。
前端本地开发循环由 `vite.config.ts` 的 proxy 保证（早已配好，直连线上真后端）。

副作用为零：生产构建本来就把 mock 整块摇掉了，删除前后 bundle 哈希相同。

### 个人资料（P1.6）

`PATCH /api/user/auth/me`，body `{nickname?, avatarUrl?}`，部分更新。

| 约定 | 值 |
|---|---|
| 目标用户 | 来自 `UserContext`，**不接受调用方传 userId**（否则能改别人） |
| 头像 | 只接受 `^https?://`，≤255；上传留到 P7 的 MinIO |
| 清空头像 | 传**空字符串**（JSON 的 null 与字段缺失无法区分） |
| 昵称 | 2~32，不允许空 |
| 写库方式 | `UpdateWrapper` 而非 `updateById`（后者忽略 null，清空会变成不改） |

**改昵称不需要重新登录**：token 里只有 `sub`/`jti`/`roles`，没有昵称。
这是"token 不放会变的数据"那个决定的直接收益，`verify-p1.sh` 有断言守着它。

**改昵称在全站立即生效**：帖子与评论**不存作者信息快照**，只存 `author_id`，
昵称头像由前端用批量接口现取（ADR 0009）。所以 P1.6 改完昵称，历史帖子也显示新昵称。

> 这条曾经写成"会冗余存快照"，P2.0 设计时推翻了：快照会让**发帖**依赖
> user-service 的同步可用性。等 P2 之后给用户摘要加缓存时，改昵称必须触发缓存失效。

### P1 验收（已完成）

`deploy/bin/verify-p1.sh`，退出码 0 即通过。**33 条自动断言 + 3 条人工**。

| 层 | 内容 | 条数 |
|---|---|---|
| L1 契约与构建 | 错误码三方一致 / spec 与类型无漂移 / typecheck / build | 4 |
| L2 后端 HTTP | 注册开关、防枚举、cookie 属性、信任边界、typ 校验、网关注入、refresh 轮换与宽限期、资料编辑、登出即时失效 | 19 |
| L3 浏览器 | 守卫、登录、静默续期、不闪登录页、存储无 token、cookie 属性、登出 | 9 |
| L4 破坏性动作 | kick / ban / unban（经 SSH 调 `/internal/admin`） | 6 |
| L5 回归 | `verify.sh`（P0）+ `verify-p05.sh`（P0.5） | 2 |

`--fast` 跳过浏览器层与破坏性动作。

测试夹具：每次运行创建一个 `e2e+p<时间戳>@kuaikan.test` 临时账号
（BCrypt 哈希内嵌，固定测试密码 `E2eFixture-Passw0rd`），`trap EXIT` 时删除
用户、refresh 行与 Redis 键，不留脏数据。

### 已知债务：refresh 行无清理任务

`t_refresh_token` 目前只增不减。P1 开发期间一天的测试就积累了 137 行
（120 已吊销 / 4 已消费 / 13 活跃）。容量基线是 200 万级，短期无碍，
但上线前必须加清理任务：

```sql
DELETE FROM t_refresh_token
WHERE revoked_at IS NOT NULL OR consumed_at IS NOT NULL OR expires_at < NOW();
```

建议挂在 XXL-Job 每日执行（与 P7 的消息归档、已删帖清理同一个任务组）。

### 服务间身份传递（ADR 0008）

**`UserContext` 只在"用户直接请求的服务"里有效。** 服务间调用不传播身份，内部接口用显式参数：

```
content-service → community-service
  GET /internal/memberships?communityId=1&userIds=1,2,3      ← 身份是参数，不是 header
```

理由：ADR 0005 已决定读路径由前端并发聚合，服务间同步调用本来就少；剩下的内部调用是
"业务对业务"，身份作为参数比作为隐式上下文更明确、更好调试，且可检查（内部接口不该出现 `UserContext`）。

我们评估过在应用层加内部签名（HMAC + 时间窗）来兜底"端口泄漏"，**结论是不做**：
能连容器端口的人基本也能读环境变量、直连 MySQL/Redis，绕过成本近乎为零；
而真实风险（意外暴露端口）已由 compose 不声明 ports + 配置层断言 + UFW 盖住。
完整权衡见 ADR 0008。

### 浏览器层验收（P1.2）

```bash
cd web
E2E_EMAIL=... E2E_PASSWORD=... npm run e2e:auth
```

9 条断言：未登录守卫 / 登录成功 / cookie 属性 / 存储无 token / 刷新不掉登录态 /
不闪登录页 / 出现 bootstrap 加载态 / 登出后重定向 / cookie 已清除。

用 **playwright 库形态**（不引 `@playwright/test`），浏览器按 内置 chromium → msedge → chrome 回退。

### 邮件（P1.1）

| 项 | 值 |
|---|---|
| 方案 | **MailHog 假 SMTP**（`devtools` profile），上线前再换真实服务商 |
| 容器 | `mailhog/mailhog:v1.0.1`，`172.30.10.20`，UI 绑 `127.0.0.1:8025`（回环，与网关同类） |
| 退化策略 | 未配置 `MAIL_HOST` 时打 `WARN` 日志输出验证码，保证无 SMTP 也能跑通注册 |
| 访问 | `ssh -L 8025:127.0.0.1:8025 root@206.237.30.147` 后打开 `http://localhost:8025` |

### 注册开关（P1.1）

`kuaikan.auth.register-enabled`，默认 **false**。真值在 Nacos：
dataId `user-service.yaml`，group `DEFAULT_GROUP`。

实测热切换：改配置后 **约 20 秒**生效，无需重启（`@ConfigurationProperties` 经 Spring Cloud 的 rebinder 重绑）。
验收脚本会用它临时打开注册、跑完再关回去。

### 错误码契约（P1.0）

| 项 | 值 |
|---|---|
| 唯一事实来源 | `contract/error-codes.json` |
| 后端镜像 | `services/**/error/*ErrorCode.java`（枚举） |
| 前端镜像 | `web/src/shared/api/error-codes.gen.ts`（生成，禁止手改） |
| 生成 | `npm run gen:contract` |
| 校验 | `node deploy/bin/check-contract.mjs` |

规则：**HTTP 状态码只表达传输层语义**（401/403/429/500），业务结果走 `code`。
唯一必须记住的例外：**登录失败是 200 + 40206，不能是 401**——否则前端 401 拦截器会去 refresh，形成"输错密码 → 跳登录页"的死循环。

### 前端 mock 开关

`VITE_API_MOCK=1 npm run dev` 启用。开关通过 `vite.config.ts` 的 `define` 注入为
**可静态折叠的常量** `__KUIKAN_API_MOCK__`，因此生产构建里整块 mock 会被摇掉
（实测：产物中 `mockRoute` 出现 0 次，且无 mock chunk）。

未注册的路径在 mock 模式下**显式抛错**，不回落真实网络——否则"为什么这个页面数据是真的、那个是假的"无从解释。

### 契约端点（内部）

| 服务 | 容器内地址 | 公网 |
|---|---|---|
| 7 个 servlet 服务 | `http://127.0.0.1:<port>/internal/api-docs` | **404**（网关 `InternalPathBlockFilter` 拦截） |

- springdoc **2.10.0**，只引 `-webmvc-api`（不含 swagger-ui）
- spec 版本 **OpenAPI 3.1.0**
- 采集：`./deploy/bin/openapi-dump.sh` → `web/openapi/<service>.json`（入库）
- 拦截证据：公网请求会触发网关 `WARN 拦截内部路径访问 path=...`，且容器内同路径返回 200

### 网关路由约定

`/api/{service}/**` → `lb://{service}`，`StripPrefix=2`。即前端请求 `/api/user/ping`，user-service 实际收到 `/ping`。

| 对外路径 | 目标服务 |
|---|---|
| `/api/user/**` | user-service |
| `/api/community/**` | community-service |
| `/api/content/**` | content-service |
| `/api/interaction/**` | interaction-service |
| `/api/notification/**` | notification-service |
| `/api/search/**` | search-service |
| `/api/rank/**` | rank-service |

### P0 期间已知的公开面（P1 收口）

以下端点当前**无需认证即可调用**，是 P0 为验收刻意保留的：

| 端点 | 风险 |
|---|---|
| `POST /api/user/ping/mq` | 任何人可写入消息，量大时会吃 broker 磁盘 |
| `GET /api/user/ping/sentinel` | 任何人可触发限流 |
| `GET /test` | 暴露服务名、容器主机名、端口、耗时（不含配置与密钥） |

P1 引入鉴权后，`/ping/**` 与 `/test` 一并纳入保护或在网关下线。

## 服务器已生效的基线配置

- `/etc/docker/daemon.json`：日志轮转 `50m × 3`、`live-restore`、地址池 `172.30.0.0/16`
- `/etc/sysctl.d/99-kuaikan.conf`：`vm.max_map_count=262144`（ES 必需）、`swappiness=10`、`file-max=1048576`、`somaxconn=1024`
- `/etc/security/limits.d/99-kuaikan.conf` + systemd `DefaultLimitNOFILE=65535`
- UFW：默认拒绝入站，仅放行 22/80/443
- ⚠️ Docker 发布端口会绕过 UFW，因此"只开 443"靠的是 compose 不映射端口，而非防火墙

## 已锁定的版本

由 `deploy/bin/check.sh` 在服务器上实测得出（P0 第 1 步，2026-11-08）。**不采信任何博客与记忆。**

### 构建与运行时

| 组件 | 实测版本 | 说明 |
|---|---|---|
| JDK（构建） | 21.0.12.1 Temurin | `maven:3.9-eclipse-temurin-21` 内 |
| JDK（运行） | 21.0.13 Temurin | `eclipse-temurin:21-jre` 内 |
| Maven | 3.9.16 | 构建镜像内 |
| 构建镜像 | `maven@sha256:99e61abcff91…` | |
| 运行镜像 | `eclipse-temurin:21-jre@sha256:0b99b3376fbb…` | |

### 框架与中间件客户端

| 组件 | 实测版本 | 来源 |
|---|---|---|
| MySQL Server | **8.4.13** | 镜像 `mysql:8.4.13` |
| Redis Server | **7.4.12** | 镜像 `redis:7.4.12-alpine` |
| Nacos Server | **3.0.3** | 镜像 `nacos/nacos-server:v3.0.3` |
| RocketMQ Server | **5.3.4** | 镜像 `apache/rocketmq:5.3.4` |
| Spring Boot | **3.5.16** | parent pom 显式指定 |
| Spring Cloud | **2025.0.3** | parent pom 显式指定 |
| → spring-cloud-commons / openfeign / loadbalancer | 4.3.3 | BOM 传递 |
| Spring Cloud Alibaba | **2025.0.0.0** | parent pom 显式指定 |
| → nacos-client | **3.0.3** | SCA 传递 → **Nacos Server 必须用 3.0.x** |
| feign-core | 13.6.1 | 传递 |
| spring-webmvc | 6.2.19 | Boot 3.5.16 传递 |
| jackson-databind | 2.21.4 | Boot 3.5.16 传递 |
| Gateway starter | `spring-cloud-starter-gateway-server-webflux` | **新 artifact 名**，旧名 `-starter-gateway` 已废弃 |

### 已实测的依赖版本（`deploy/bin/versions.sh` 输出）

| 组件 | 版本 |
|---|---|
| spring-boot-starter-web | 3.5.16 |
| spring-cloud-commons / openfeign / loadbalancer | 4.3.3 |
| spring-cloud-starter-alibaba-nacos-discovery | 2025.0.0.0 |
| spring-cloud-starter-alibaba-sentinel | 2025.0.0.0 |
| nacos-client | 3.0.3 |
| rocketmq-client | 5.3.1 |
| sentinel-core | 1.8.9 |
| feign-core | 13.6.1 |
| jackson-databind | 2.21.4 |
| spring-webmvc | 6.2.19 |

## P0.5 验收（已完成）

`deploy/bin/verify-p05.sh`，退出码 0 即通过。**11 条自动断言 + 2 条人工**。

| 层 | 断言 | 实测 |
|---|---|---|
| L1 | typecheck 0 error / build 成功 / `__error-demo` 不进产物 | ✓ js 384K |
| L2 | `gen:types` 后 `git diff` 为空（契约漂移探测） | ✓ |
| L3 | Node 直连后端，7 个服务 + 1 个 404 | ✓ 8 项 |
| L4 | 线上是 Vite 产物而非占位页 | ✓ |
| L5 | `/assets/*.js` → 200 且 `application/javascript` | ✓ |
| L6a | `/whatever` → 200 且是 index.html | ✓ |
| L6b | 浏览器确认（人工） | 待确认 |
| L7 | `/api/user/internal/api-docs` → 404 | ✓ |
| L8 | 服务器 `verify.sh` P0 回归 | ✓ 14 通过 |
| L9 | `git status` 为空 | ✓ |

发布链路：`deploy/bin/deploy-web.sh` —— 本地 `typecheck + build` → `COPYFILE_DISABLE=1 tar --no-xattrs` over SSH
→ 解到 `dist.new` 后原子换名 → 立即冒烟（首页非占位 / 有 module script / 资源 200 / `/test/` 仍 200）。
**只动 `frontend/dist`，`test/` 是兄弟目录，物理上不可能被覆盖。**

## P0 验收（已完成）

**判定方式不是文字描述，而是可执行脚本**：`deploy/bin/verify.sh`，退出码 0 即通过。

```bash
./deploy/bin/verify.sh              # 常规验收（含重启自愈）
./deploy/bin/verify.sh --no-restart # 跳过重启
./deploy/bin/verify.sh --cold       # 先 down 再 up all，含冷启动计时
```

16 条断言全部覆盖：边缘存活 / 13 容器健康 / 8 服务注册 / 7 条网关路由 / Feign 服务发现 /
RocketMQ 端到端 / Sentinel 限流 / Actuator readiness / 端口收敛 / 重启自愈 / 日志无异常 / 公网全链路。

### P0 实测指标

| 指标 | 实测值 |
|---|---|
| 验收断言 | **16 通过 / 0 失败** |
| 冷启动（down → up all → 全绿） | **120 秒** |
| 单服务重启自愈 | **16~17 秒** |
| 全量构建 8 个镜像 | 约 16~110 秒（BuildKit 缓存命中时 16 秒） |
| RocketMQ 稳态端到端 | **0~1 秒** |
| RocketMQ 首条消息（消费组刚启动，含 rebalance） | 8~15 秒 |
| Sentinel（QPS=2） | 放行 2 次 / 限流 8 次，429 + `code 42900` |
| 全栈常驻内存（13 容器） | 5.8 GB / 15 GB |
| 磁盘 | 24 GB / 79 GB（31%） |

### 镜像体积

| 镜像 | 体积 | 说明 |
|---|---|---|
| 基础 `eclipse-temurin:21-jre` | 456 MB | 不可压缩部分，已自带 curl |
| content / interaction / notification / search / rank | **558 MB** | 基础 + 51 MB jar |
| gateway | 562 MB | 基础 + 54 MB jar |
| community / user | **688 / 694 MB** | jar 115/118 MB（含 rocketmq-client + sentinel 依赖） |

镜像构建的两条教训（已写入 Dockerfile 注释）：

1. **`COPY` 之后再 `RUN chown` 会触发 copy-up**，把 51 MB 的 jar 复制成第二个层，每个镜像白占约 53 MB。
   必须用 `COPY --chown=app:app`。
2. **`eclipse-temurin:21-jre` 已自带 curl 8.18.0**，运行阶段不需要 `apt-get install curl`；
   那一层既是白做的，又引入了构建期对 apt 源的依赖。

BuildKit 缓存 8.5 GB（其中 Maven 依赖约 1 GB）**属于基础设施，不要 `docker builder prune`**，
否则下次构建要重下约 1 GB 依赖。
