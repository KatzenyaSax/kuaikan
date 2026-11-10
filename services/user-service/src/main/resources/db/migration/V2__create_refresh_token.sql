-- P1.2：refresh token。
--
-- 真相只在 MySQL，不进 Redis（理由见 docs/design/p1-storage.md）：
--   * /sessions 要能分页列出登录设备，Redis 不适合
--   * 吊销要可审计（revoked_at / replaced_by_jti 能串出完整轮换链）
--   * /auth/refresh 是低频接口，走 MySQL 完全够
-- 代价是"双写一致性"问题被彻底避免——Redis 只负责 access 白名单这个热路径。

CREATE TABLE IF NOT EXISTS t_refresh_token (
  id              BIGINT       NOT NULL                COMMENT '雪花 ID',
  user_id         BIGINT       NOT NULL,
  jti             CHAR(36)     NOT NULL                COMMENT 'refresh token 的 jti',
  family_id       CHAR(36)     NOT NULL                COMMENT '一次登录 = 一个家族，重放时整族吊销',
  issued_at       DATETIME(3)  NOT NULL,
  expires_at      DATETIME(3)  NOT NULL,
  consumed_at     DATETIME(3)  NULL                    COMMENT '首次用于轮换的时刻，宽限期从此刻起算',
  revoked_at      DATETIME(3)  NULL,
  replaced_by_jti CHAR(36)     NULL                    COMMENT '审计用，可串出轮换链',
  last_used_at    DATETIME(3)  NULL,
  user_agent      VARCHAR(255) NULL,
  ip              VARCHAR(45)  NULL                    COMMENT 'IPv6 最长 45',
  PRIMARY KEY (id),
  UNIQUE KEY uk_rt_jti (jti),
  KEY idx_rt_family (family_id),
  KEY idx_rt_user (user_id, issued_at),
  KEY idx_rt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='refresh token';
