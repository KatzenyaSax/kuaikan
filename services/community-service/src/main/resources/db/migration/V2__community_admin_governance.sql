-- P7.1 社群治理：社群头像 / 公告、社群封禁、社群历史。
--
-- 一次迁移引入三样东西，因为它们互相咬合（见 docs/design/p7-community-admin.md §3）：
--   * t_community 追加两列 —— 管理员可编辑的图像/公告，是"社群信息"的一部分
--   * t_community_ban  —— 封禁必须独立成表，不能塞进 t_community_member：
--     要能封禁**已退群**的人（防发完违规帖退群逃避），而"已退群的成员行"和
--     "被封禁的人"在成员表里是同一行，复用会让 member_count 与复活逻辑变得不可推理
--   * t_community_history —— 编年史是**只追加**的事件流，不是可变的业务状态

-- ---------------------------------------------------------------------------
-- 1. t_community 追加列（向后兼容：两列都 NULL，存量行不受影响）
-- ---------------------------------------------------------------------------
-- 名称（name / name_key）**不加可改能力**：它已经是 URL 与消息/搜索缓存的一部分，
-- 改名等于让所有旧链接失效（p2-content.md §3.1 的结论，P7 不改）。

ALTER TABLE t_community
  ADD COLUMN avatar_url   VARCHAR(512)  NULL COMMENT '社群头像外链 URL' AFTER description,
  ADD COLUMN announcement VARCHAR(1000) NULL COMMENT '社群公告/规则' AFTER avatar_url;

-- ---------------------------------------------------------------------------
-- 2. t_community_ban —— 一个 (社群, 用户) 只有一行，重新封禁走覆盖而不是追加
-- ---------------------------------------------------------------------------
-- **有效封禁判定**：status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))。
-- 限时封禁到期后**自然失效**，用户可以直接重新加入，不需要定时任务扫表——
-- 定时任务意味着"到期时间"与"能否加入"之间存在一段谁都不确定的时间窗。
-- 因此下面所有读路径都必须带上这个条件，不能只看 status = 1。
--
-- uk_community_user 让"重新封禁一个之前被封过的人"必须走 UPDATE 而不是再 INSERT；
-- 这也保证了历史行不会因为反复封禁而无限膨胀。

CREATE TABLE t_community_ban (
  id            BIGINT UNSIGNED NOT NULL,
  community_id  BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  banned_by     BIGINT UNSIGNED NOT NULL,
  reason        VARCHAR(200)    NULL,
  expires_at    DATETIME(3)     NULL COMMENT 'NULL 表示永久封禁',
  status        TINYINT         NOT NULL DEFAULT 1 COMMENT '1 生效中 / 0 已解封',
  banned_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  unbanned_at   DATETIME(3)     NULL,
  unbanned_by   BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_community_user (community_id, user_id),
  -- 封禁名单的游标分页是 (banned_at DESC, id DESC)，排序键必须在索引里，
  -- 否则每翻一页都要把该社群的封禁行全读出来再 filesort
  KEY idx_community_status_banned (community_id, status, banned_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. t_community_history —— 只追加的事件流
-- ---------------------------------------------------------------------------
-- 分类约定（category）：
--   MILESTONE  = 社群创建 / 管理员转让 / 信息更新   —— "这个社群经历过什么"
--   MODERATION = 封禁 / 解封                        —— "这个社群治理过谁"
-- category 是**冗余列而不是从 event_type 推导**：它决定前端两个筛选页签和
-- 索引 idx_community_cat_created 的形状，推导意味着每次查询都要写一长串 IN。

CREATE TABLE t_community_history (
  id              BIGINT UNSIGNED NOT NULL,
  community_id    BIGINT UNSIGNED NOT NULL,
  event_type      VARCHAR(32)     NOT NULL COMMENT 'COMMUNITY_CREATED|ADMIN_TRANSFERRED|INFO_UPDATED|MEMBER_BANNED|MEMBER_UNBANNED',
  category        VARCHAR(16)     NOT NULL COMMENT 'MILESTONE|MODERATION',
  operator_id     BIGINT UNSIGNED NOT NULL,
  target_user_id  BIGINT UNSIGNED NULL,
  detail          VARCHAR(500)    NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 时间线（全部事件）：游标是 (created_at DESC, id DESC)
  KEY idx_community_created (community_id, created_at DESC, id DESC),
  -- 时间线（按分类筛选）：少一次回表过滤
  KEY idx_community_cat_created (community_id, category, created_at DESC, id DESC),
  -- 历代管理员：按 event_type 过滤并**正序**扫，与时间线方向相反，单独一条
  KEY idx_community_event_created (community_id, event_type, created_at ASC, id ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. 存量回填：每个正常社群补一条 COMMUNITY_CREATED
-- ---------------------------------------------------------------------------
-- 回填必须走迁移，不能留给应用层"读不到就当没发生"：P7.3 的 /c/:name/history
-- 对存量社群必须立刻有内容，否则第一批上线的社群历史页全是空白，
-- 而那看起来像"功能坏了"而不是"历史从今天开始记"。
--
-- id **复用 t_community.id**：这条记录与社群是同一次创建的产物，用同一个 id
-- 省掉一次雪花分配，也让运维在两张表之间对着 id 找行时不必换算。
-- 不会与后续新事件撞号：新事件的雪花 id 由更晚的时刻生成，单调递增。
--
-- operator_id / target_user_id 都是 owner_id：创建者既是操作人，也是当时的管理员。
-- detail 与 P7.1 应用层写入口径一致（"创建了社群"）。

INSERT INTO t_community_history (id, community_id, event_type, category, operator_id, target_user_id, detail, created_at)
SELECT id, id, 'COMMUNITY_CREATED', 'MILESTONE', owner_id, owner_id, '创建了社群', created_at
FROM t_community
WHERE status = 1;
