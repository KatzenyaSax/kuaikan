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
| 服务器 | 境外（待采购），8C16G，月预算 ≈ ¥300 档 |
| 域名 | 待定（免 ICP 备案） |
| 公网暴露 | 仅 443（Nginx） |
| 编排 | 阶段一 Docker Compose，阶段二单节点 k3s（ADR 0007） |
| 网关路由前缀 | `/api/**`（`/internal/**` 不经网关） |
| 心跳间隔 | SSE 心跳 15s，网关与 Nginx 超时 > 30s |

## 已锁定的版本

**待 P0 spike 实测后回填。** 在此之前任何版本号都是假设，不得写入代码注释或文档作为结论。系列约束见 `docs/design/architecture.md` §3。

| 组件 | 实测版本 | 实测日期 |
|---|---|---|
| _（待填）_ | | |
