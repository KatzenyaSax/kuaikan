-- 社群与社群成员。
--
-- 两张表同一刀引入（P2.1）："建社群"本质上就是"建社群 + 成为第一个成员"，
-- 没有成员表就无法表达创建者、member_count 也对不上。
--
-- 没有 slug 列 —— 社群名本身就是标识（见 docs/design/p2-content.md §3.1）：
--   name     = 展示名，用户输入原文（trim 后），创建后不可改
--   name_key = 规范化唯一键（NFKC + trim + lower + 连续空白转 "-"），URL 用它
--
-- 不预建未来才用的列（头像、封面、分类、禁言等）：加列便宜，猜错的列才是负担。

CREATE TABLE t_community (
  id            BIGINT UNSIGNED NOT NULL                COMMENT '雪花 id',
  name          VARCHAR(32)  NOT NULL                   COMMENT '展示名，创建后不可改',
  name_key      VARCHAR(64)  NOT NULL                   COMMENT '规范化唯一键，URL 用它',
  description   VARCHAR(500) NULL                       COMMENT '自我介绍，纯文本，允许换行',
  owner_id      BIGINT UNSIGNED NOT NULL                COMMENT '所有者。是社群的属性，不是成员角色',
  member_count  INT UNSIGNED NOT NULL DEFAULT 1         COMMENT '成员数，唯一写入者是 community-service',
  status        TINYINT NOT NULL DEFAULT 1              COMMENT '1 正常 / 0 已删除 / 2 已封禁(P7)',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_name_key (name_key),
  KEY idx_status_created (status, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='社群';

CREATE TABLE t_community_member (
  id            BIGINT UNSIGNED NOT NULL,
  community_id  BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  role          TINYINT NOT NULL DEFAULT 0              COMMENT '0 成员 / 1 管理员（P7 才有写入者）',
  status        TINYINT NOT NULL DEFAULT 1              COMMENT '1 在社 / 0 已退出',
  joined_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 这个唯一键决定了"退出再加入"必须走复活（ON DUPLICATE KEY UPDATE status=1），
  -- 不能 DELETE + INSERT 两步走
  UNIQUE KEY uk_community_user (community_id, user_id),
  KEY idx_user_joined (user_id, status, joined_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='社群成员';
