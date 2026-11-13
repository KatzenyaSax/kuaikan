-- 互动事实表与 outbox。
--
-- t_interaction：点赞 / 收藏的**事实**。计数（post.like_count 等）在 content 侧，
-- 是这张表经事件投影出来的**派生值**。事实与派生分属两个服务，所以那个计数
-- 只能是最终一致（见 ADR 0010）。
--
-- t_outbox：待投递事件。它不是消息队列，是"待办事项表"——
-- 解决的是"数据库事务与消息发送无法原子"这个问题（不是性能问题）。

CREATE TABLE t_interaction (
  id           BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         TINYINT NOT NULL          COMMENT '1 点赞 / 2 收藏',
  target_type  TINYINT NOT NULL          COMMENT '1 帖子 / 2 评论',
  target_id    BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 幂等第一层：同一个 (用户, 种类, 目标) 只能有一行。
  -- 配合"设为已赞/未赞"的接口语义 + INSERT IGNORE 的 affectedRows，
  -- 重复点赞根本不会产生第二个事件。
  UNIQUE KEY uk_user_kind_target (user_id, kind, target_type, target_id),
  -- 对账用它做 COUNT(*)：前缀 (kind, target_type, target_id) 正好是分组条件；
  -- 将来"谁赞了这篇"的列表也能复用同一条索引
  KEY idx_kind_target (kind, target_type, target_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='互动事实';

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
