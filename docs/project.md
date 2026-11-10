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
| 静态站点 | `/` 根占位页；`/test/` 冒烟控制台（源码在 `deploy/status/`，`deploy/bin/install-status.sh` 发布） |
| 前端产物目录 | `/opt/kuaikan/frontend/dist`（真实前端）与 `/opt/kuaikan/frontend/test`（冒烟台） |
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

前端产物（S2 后）：`index.js` 368 KB（gzip 117 KB）、`index.css` 11.3 KB（gzip 3.1 KB）。

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
| `GET /test/` | 暴露服务名、容器主机名、端口、耗时（不含配置与密钥） |

P1 引入鉴权后，`/ping/**` 与 `/test/` 一并纳入保护或在网关下线。

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
