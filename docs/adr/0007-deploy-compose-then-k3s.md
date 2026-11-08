# 部署：境外单机 Compose 先行，上线前迁 k3s

容器编排分两阶段。功能开发期：单台 8C16G 境外服务器上用 Docker Compose 运行全部中间件，8 个 Java 服务在开发机 IDE 内运行（容器跑 Java 热部署体验极差）。上线前：把服务迁到单节点 k3s + Helm。服务器选境外（香港）以规避 ICP 备案对上线时间的阻塞，代价是 50~100ms 额外网络延迟，在本容量下不可观测。

## Considered Options

- **一开始就上 K8s**：会在写出业务代码之前吃掉两到三周，且开发期迭代速度显著下降。
- **大陆服务器**：网络更好，但需 1~3 周 ICP 备案，期间无法用域名访问。
- **云托管中间件（RDS / 云 Redis / 云 RocketMQ）**：省内存、省运维，但费用翻倍，且把最想学的运维细节全托管掉了。

## Consequences

- 全量栈常驻内存约 9.5GB（含 ES 与 SkyWalking），机器低于 8C16G 会 OOM；一期砍掉 ES + SkyWalking 可降到 8C8G。
- Compose 的 profile 分组（`core` / `observe` / `extra`）在迁 k3s 后也必须保留，它是本地一键拉起全套的唯一入口。
- 单节点 k3s 学不到真实调度与网络，它能提供的是 Deployment/Service/Ingress/探针/Helm 的写法经验，不要指望它等于生产级编排。
