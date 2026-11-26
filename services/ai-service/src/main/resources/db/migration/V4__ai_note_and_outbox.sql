CREATE TABLE t_ai_note (
  id          BIGINT UNSIGNED NOT NULL,
  owner_id    BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(100)    NOT NULL,
  content     MEDIUMTEXT      NOT NULL,
  enabled     TINYINT         NOT NULL DEFAULT 1 COMMENT '1 启用参与检索 / 0 停用',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_owner_updated (owner_id, updated_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE t_outbox (
  id             BIGINT UNSIGNED NOT NULL,
  event_id       VARCHAR(36) NOT NULL  COMMENT 'UUID，重投时保持不变',
  topic          VARCHAR(64) NOT NULL,
  payload        TEXT NOT NULL         COMMENT '序列化后的事件快照',
  status         TINYINT NOT NULL DEFAULT 0 COMMENT '0 待投递 / 1 已投递 / 2 已放弃',
  retry_count    INT NOT NULL DEFAULT 0,
  next_retry_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_id (event_id),
  KEY idx_status_next (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='待投递事件';
