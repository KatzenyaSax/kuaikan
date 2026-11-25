CREATE TABLE t_ai_conversation (
  id          BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(100)    NOT NULL DEFAULT '新对话',
  status      TINYINT         NOT NULL DEFAULT 1 COMMENT '1 正常 / 0 已删除',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_user_updated (user_id, updated_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE t_ai_message (
  id                BIGINT UNSIGNED NOT NULL,
  conversation_id   BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  role              ENUM('user', 'assistant', 'tool') NOT NULL,
  content           MEDIUMTEXT      NULL,
  tool_calls        JSON            NULL,
  tool_call_id      VARCHAR(64)     NULL,
  citations         JSON            NULL,
  page_context      JSON            NULL,
  prompt_tokens     INT UNSIGNED    NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conv_id (conversation_id, id ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
