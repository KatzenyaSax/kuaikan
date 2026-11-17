-- t_message：投递给用户的消息。
--
-- **消息是自包含快照，不是"指向当前状态的外键"**（不变量 9）。
-- actor_nickname / actor_avatar / target_title / excerpt 在写入那一刻固化成字符串，
-- 之后对方改名、换头像、删帖子，这条消息都保持原样。
-- 这与 ADR 0009（帖子作者实时拉取）方向相反，是有意的：
--   消息是历史记录，帖子是当前状态。

CREATE TABLE t_message (
  id               BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL             COMMENT '接收人',
  type             VARCHAR(16) NOT NULL                 COMMENT 'LIKE / COMMENT / MENTION / SYSTEM',

  -- 幂等键。**这样就不需要 t_consume_log**：
  -- 架构 §6 的优先级是「唯一索引 > 去重表 > 对账」，而这里的去重键
  -- 和被保护的数据在**同一行**，一次 INSERT 就完成全部工作。
  -- content 走不了这一档，因为它的去重键要保护 t_post.like_count（另一行）。
  source_event_id  CHAR(36)    NOT NULL                 COMMENT '来源事件 id，重投时不变',

  actor_id         BIGINT UNSIGNED NULL                 COMMENT '动作发起人；SYSTEM 为空',
  actor_nickname   VARCHAR(64) NULL                     COMMENT '快照，非实时',
  actor_avatar     VARCHAR(512) NULL,

  target_type      VARCHAR(16) NULL                     COMMENT 'POST / COMMENT；SYSTEM 为空',
  target_id        BIGINT UNSIGNED NULL,
  target_title     VARCHAR(255) NULL                    COMMENT '快照：帖子标题',
  excerpt          VARCHAR(255) NULL                    COMMENT '快照：正文摘录',

  read_at          DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL,

  PRIMARY KEY (id),
  -- 一个接收人，一次事件，最多一条消息。
  -- 两列而不是三列（不加 type）：因为合并规则保证"回复你 + 同时 @ 你"
  -- 只产生一条（优先级 COMMENT > MENTION）。加 type 会让这条约束失效。
  UNIQUE KEY uk_user_event (user_id, source_event_id),
  -- 列表：WHERE user_id = ? AND type = ? ORDER BY created_at DESC, id DESC
  KEY idx_list (user_id, type, created_at, id),
  -- 未读：SELECT type, COUNT(*) WHERE user_id = ? AND read_at IS NULL GROUP BY type
  KEY idx_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户消息';

-- 为什么 type 用 VARCHAR 而不是 TINYINT（项目里 kind/status 都是 TINYINT）：
-- 消息类型会被人读。排查时 `SELECT type FROM t_message` 一眼就懂，
-- `SELECT kind` 还得回来查 1 是点赞还是收藏。只有 4 个值，索引开销可以忽略。
