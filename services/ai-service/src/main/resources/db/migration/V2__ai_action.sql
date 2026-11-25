CREATE TABLE t_ai_action (
  id              BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(32)     NOT NULL COMMENT 'CREATE_POST|FAVORITE_POSTS|FOLLOW_USER|JOIN_COMMUNITY|UPDATE_NICKNAME|UPDATE_AVATAR',
  payload         JSON            NOT NULL,
  status          VARCHAR(16)     NOT NULL DEFAULT 'PROPOSED' COMMENT 'PROPOSED|EXECUTED|FAILED|REJECTED|EXPIRED',
  result          JSON            NULL,
  expires_at      DATETIME(3)     NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_user_status (user_id, status, created_at DESC),
  KEY idx_conv_id (conversation_id, id ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
