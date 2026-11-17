-- t_outbox：待投递事件。它不是消息队列，是"待办事项表"——
-- 解决的是"数据库事务与消息发送无法原子"这个问题（不是性能问题）。
--
-- 结构与 interaction schema 的 t_outbox 完全一致。**刻意不共用一张表**：
-- outbox 必须与业务数据在同一个库、同一个事务里，跨服务共用就回到了共享数据库
-- （ADR 0006 一个库一个账号）。所以每个发事件的服务建自己的一份。
--
-- 这个文件是 P4.0 建的。写它的同时，评论的写入路径才开始写 outbox ——
-- 两者必须一起上线，否则 OutboxRelay 会每秒扫一张不存在的表。

CREATE TABLE t_outbox (
  id             BIGINT UNSIGNED NOT NULL,
  event_id       VARCHAR(36) NOT NULL  COMMENT 'UUID，重投时保持不变（幂等的前提）',
  topic          VARCHAR(64) NOT NULL,
  payload        TEXT NOT NULL         COMMENT '序列化后的事件快照；投递时原样发出，不回查业务表',
  status         TINYINT NOT NULL DEFAULT 0 COMMENT '0 待投递 / 1 已投递 / 2 已放弃',
  retry_count    INT NOT NULL DEFAULT 0,
  next_retry_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_id (event_id),
  -- 轮询查询：WHERE status=0 AND next_retry_at <= NOW()
  KEY idx_status_next (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='待投递事件';
