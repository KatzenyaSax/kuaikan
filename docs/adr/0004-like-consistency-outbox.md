# 点赞一致性：本地消息表 + 定时对账，不用事务消息

`interaction-service` 把 `t_like` 与 `t_outbox` 写在同一个本地事务里。幂等靠 `INSERT IGNORE` + 唯一索引 `(user_id, target_type, target_id)`，用 affected rows 判断是否真实新增；只有真实新增才更新 Redis 计数并写入 outbox。XXL-Job 扫描未发送的 outbox 记录重投 RocketMQ，消费端用 `t_consume_log(event_id, consumer)` 的唯一索引去重。最后再加一道对账：定时用事实表重算热门目标的计数并强制覆盖 Redis，修正任何累积偏差。

## Considered Options

- **RocketMQ 事务消息**：少一张表，技术含量更高；但回查接口实现有误会造成消息黑洞，且出问题时不可观测、无法人工重放。
- **只靠 MQ、不做对账**：任何一次投递或消费异常都会让计数永久偏离，且没有自愈路径。

## Consequences

- 计数的核心指标从"实时"换成"可自愈"："Redis 计数与事实表重算值不相等"本身就是一条监控告警。
- 计数允许 5 秒滞后，用户自己的点赞状态不允许滞后。
- outbox 表必须可人工重放，这是它的主要价值，不是副产品。
