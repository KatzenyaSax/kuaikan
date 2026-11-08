# kuaikan

一个以**社群**为单位组织内容的讨论社区：用户加入感兴趣社群，在其中发帖、评论、点赞、收藏，并收到他人互动产生的消息。

架构评审阶段已完成，尚未开始编码。

## 技术栈

- **后端**：Java 21 / Spring Boot 3.5 / Spring Cloud Alibaba（Nacos + Sentinel）/ OpenFeign / RocketMQ / MyBatis-Plus / MySQL 8.4 / Redis 7
- **搜索**：Elasticsearch 8 + IK
- **可观测性**：SkyWalking / Prometheus + Grafana / Loki
- **前端**：React 19 + TypeScript + Vite + TanStack Query
- **入口与部署**：Nginx / Docker Compose → 单节点 k3s

## 架构形态

1 网关 + 7 服务 = 8 个进程，共用一台 MySQL 实例但**各自独立 schema**（禁止跨 schema 查询）。

| 进程 | 职责 |
|---|---|
| `gateway` | 路由、JWT 验签、限流 |
| `user-service` | 账号、认证、资料、关注、封禁 |
| `community-service` | 社群、成员、角色、禁言 |
| `content-service` | 帖子、评论、计数快照 |
| `interaction-service` | 点赞、收藏 |
| `notification-service` | 消息、未读数、SSE |
| `search-service` | 全文检索索引（投影） |
| `rank-service` | 热榜排行投影（投影） |

## 文档

| 文件 | 内容 |
|---|---|
| [`CONTEXT.md`](./CONTEXT.md) | 领域词汇表（术语与禁用语），**改代码前先读** |
| [`docs/project.md`](./docs/project.md) | 技术事实：容量基线、进程与 schema、运行环境、实测版本号 |
| [`docs/design/architecture.md`](./docs/design/architecture.md) | 架构方案、事件目录、计数归属、缓存分层、数据模型、**不变量清单** |
| [`docs/design/roadmap.md`](./docs/design/roadmap.md) | P0–P7 交付顺序与各阶段验收标准 |
| [`docs/adr/`](./docs/adr/) | 不可回退的架构决策记录 |

## 待办

- **P0 版本矩阵 spike**：跑通 Nacos 注册 → 网关路由 → Feign → Sentinel → RocketMQ → MyBatis-Plus → Redis，把实测版本号回填 `docs/project.md`。

## 仓库约定

- 不写单元测试与 TDD 测试（见 `AGENTS.md`）。
- `docs/project.md` 是唯一存放技术事实的文档；方案进 `docs/design/`。
