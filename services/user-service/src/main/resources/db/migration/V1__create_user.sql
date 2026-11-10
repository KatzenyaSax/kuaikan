-- P1.1：账号表。
--
-- 归属 kuaikan_user schema，由 u_user 账号执行（该账号只有本 schema 权限，
-- 跨库访问在 P1.0 之前已实测被拒绝，见 ADR 0006）。
--
-- 设计取舍见 docs/design/p1-storage.md：
--   * email 入库前已小写化，大小写统一在应用层做，不依赖 COLLATE
--   * nickname 不唯一（@提醒 走 userId，不靠昵称反查）
--   * roles 用逗号串（P1 只有 USER，P7 再评估关系表）
--   * status 用 TINYINT 而非 ENUM（加状态只需改代码，不用 ALTER）

CREATE TABLE IF NOT EXISTS t_user (
  id            BIGINT       NOT NULL                COMMENT '雪花 ID',
  email         VARCHAR(254) NOT NULL                COMMENT '入库前已小写化',
  password_hash VARCHAR(100) NOT NULL                COMMENT 'BCrypt，60 字符；留 100 以便将来换 Argon2',
  nickname      VARCHAR(32)  NOT NULL                COMMENT '不唯一',
  avatar_url    VARCHAR(255) NULL                    COMMENT 'P1 不接上传',
  roles         VARCHAR(64)  NOT NULL DEFAULT 'USER' COMMENT '逗号分隔，透传到 token',
  status        TINYINT      NOT NULL DEFAULT 1      COMMENT '1=NORMAL 2=BANNED',
  banned_reason VARCHAR(255) NULL,
  banned_at     DATETIME(3)  NULL,
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)  NULL                    COMMENT '逻辑删除（不变量 4）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_email (email),
  KEY idx_user_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='账号';
