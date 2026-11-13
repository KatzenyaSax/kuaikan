-- 评论，以及 t_post 的三个计数列。
--
-- 计数列在 P2 刻意没建（当时没有写入者，口径也没定）。现在有了写入者，一次补齐。
--   post.comment_count  该帖所有层级的可见评论总数，强一致（同一本地事务）
--   post.like_count     最终一致，由 interaction 的事件投影（P3.2）
--   post.favorite_count 同上
--
-- MySQL 8 对加列是 ALGORITHM=INSTANT（元数据操作），百万行也是秒级，
-- 当初推迟的代价确实是零。

ALTER TABLE t_post
  ADD COLUMN comment_count  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '可见评论总数（含各层级）',
  ADD COLUMN like_count     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'P3.2 由事件投影',
  ADD COLUMN favorite_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'P3.2 由事件投影';

CREATE TABLE t_comment (
  id                   BIGINT UNSIGNED NOT NULL,
  post_id              BIGINT UNSIGNED NOT NULL,
  -- 所属一级评论；一级评论自身为 NULL
  root_comment_id      BIGINT UNSIGNED NULL,
  -- 直接回复的评论；一级评论为 NULL。
  -- 叫 reply_to_comment_id 而不是 parent_id：parent 描述的是树结构，
  -- 而我们的展示是两级平铺（C 回复 B，但 UI 上 C 和 B 平级）。
  -- 名字描述语义，才不会诱导出递归实现。
  reply_to_comment_id  BIGINT UNSIGNED NULL,
  -- 直接回复的人。不是缓存而是快照："我当时回复的是张三"，张三删号后仍应显示
  reply_to_user_id     BIGINT UNSIGNED NULL,
  author_id            BIGINT UNSIGNED NOT NULL,
  body                 VARCHAR(2000) NOT NULL,
  like_count           INT UNSIGNED NOT NULL DEFAULT 0,
  -- 该一级评论下的**全部可见回复数**（不是直接子节点数）：
  -- 两级平铺下"展开 N 条回复"的 N 必须等于展开后出现的条数
  reply_count          INT UNSIGNED NOT NULL DEFAULT 0,
  -- 1 正常 / 0 已删除(tombstone) / 2 已隐藏(P7)
  -- 不变量：status=0 的评论一定有回复（无回复的评论删除时物理删）
  status               TINYINT NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 一级列表：WHERE post_id=? AND root_comment_id IS NULL ORDER BY created_at ASC, id ASC
  KEY idx_post_root_comment (post_id, root_comment_id, created_at, id),
  -- 二级列表：WHERE root_comment_id=? ORDER BY created_at ASC, id ASC
  KEY idx_root_comment_created (root_comment_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='评论';
