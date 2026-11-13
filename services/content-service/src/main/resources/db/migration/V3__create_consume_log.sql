-- 消费去重记录。幂等的第二层（第一层是写事实时的唯一键）。
--
-- 消费的三个步骤（写日志、改计数）**必须同事务**：
--   如果先改计数再记日志，中间崩溃 → 重投时会 +2
--   如果先记日志后改计数，同样是错的
-- 所以只能一起提交。
--
-- 为什么要第二层：MQ 是 at-least-once，重复投递是必然事件（重试、consumer 重启、
-- 网络分区都会造成），不是意外。

CREATE TABLE t_consume_log (
  id          BIGINT UNSIGNED NOT NULL,
  event_id    VARCHAR(36) NOT NULL,
  consumer    VARCHAR(64) NOT NULL  COMMENT '消费者标识，如 content-like-count',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 同一事件同一消费者只能消费一次
  UNIQUE KEY uk_event_consumer (event_id, consumer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='消费去重记录';
