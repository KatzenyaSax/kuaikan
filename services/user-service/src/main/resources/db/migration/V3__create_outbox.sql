-- t_outbox：待投递事件。结构与 interaction / content 的完全一致。
--
-- P4.4 给 user-service 接上，因为封禁要发 UserBanned。
-- 这是第三个接入方——当初把 outbox 抽成 kuaikan-common-outbox 的判断在这里兑现：
-- 现在只需要加依赖 + 建表 + 一行配置，不需要再复制一遍 relay。

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
  KEY idx_status_next (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='待投递事件';
