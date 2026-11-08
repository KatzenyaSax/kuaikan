# 部署：全组件容器化，Compose 先行，上线前迁 k3s

**8 个 Java 服务与全部中间件一律以容器运行**，不存在"服务在宿主机、中间件在容器"的混合形态。开发与集成用单台 8C16G 境外机器 + Docker Compose，上线前迁单节点 k3s + Helm。服务器选境外（香港）以规避 ICP 备案对上线时间的阻塞，代价是 50~100ms 额外网络延迟，在本容量下不可观测。

选择全容器化的首要理由不是"更先进"，而是**地址空间只有一套**：混合形态下 Nacos 注册的是容器 IP，从宿主机不可达，Feign 调用会跨两个网络域失败——这是本项目最容易白白消耗一整天的问题。全容器化后所有进程共享一个 Compose 网络，本地与线上形态一致。

## Considered Options

- **中间件容器化 + 服务在 IDE 运行**：热重载最快，但产生两套网络地址空间，且本地形态与线上不一致。
- **一开始就上 K8s**：会在写出业务代码之前吃掉两到三周。
- **大陆服务器**：网络更好，但需 1~3 周 ICP 备案，期间无法用域名访问。
- **云托管中间件（RDS / 云 Redis / 云 RocketMQ）**：省内存、省运维，但费用翻倍，且把最想学的运维细节全托管掉了。

## Consequences

- 每个服务一个**多阶段 Dockerfile**：`maven:3.9-eclipse-temurin-21` 构建 → `eclipse-temurin:21-jre` 运行；依赖层与 jar 层分离以命中构建缓存。
- **改代码必须重建镜像**，迭代比 IDE 慢。缓解手段：Spring Boot DevTools + 挂载 `target/classes`，或 `docker compose watch`；需要断点时用 5005 远程调试端口（仅开发 profile 映射）。
- **JVM 必须显式限制堆**（`-XX:MaxRAMPercentage`），否则容器内会按宿主机内存计算，导致 OOMKilled。
- **每个服务必须有 healthcheck**，Compose 用 `depends_on: condition: service_healthy` 控制启动顺序，否则 Nacos / RocketMQ 未就绪时服务注册失败并刷屏重试。
- 本地开发机需给 Docker VM 分配 ≥10GB 内存；机器不足时本地只起 `core` profile + 在改的那 1~2 个服务，全量 `app` profile 用于集成验证与服务器部署。
- 全量栈常驻内存约 9.5GB（含 ES 与 SkyWalking），机器低于 8C16G 会 OOM；一期不启 ES + SkyWalking 可降到 8C8G。
- Compose 的 profile 分组（`core` / `app` / `observe` / `extra`）在迁 k3s 后也必须保留，它是本地一键拉起全套的唯一入口。
- 单节点 k3s 学不到真实调度与网络，它能提供的是 Deployment/Service/Ingress/探针/Helm 的写法经验，不要指望它等于生产级编排。
