-- P5：热度所需的三个新列 + 两个候选查询索引。
--
-- view_count / share_count：**累计值**，不按天存。
--   热度的强信号（评论/赞/收藏）用窗口增量，这两个用累计并额外降权，
--   理由见 docs/design/p5-rank.md §2.2：按天存就要加每日清零任务，
--   那是在给自己造对账问题，而它们的口径本来就是"不要求精确"。
--
-- last_interaction_at：最后一次有人对这个帖子做任何互动的时刻。
--   **衰减基准用它而不是 created_at**：用创建时间等于老帖永无翻身；
--   用最后互动时间等于"每次互动把帖子重新点燃"，
--   这本身就是活跃度的近似，不需要真算增速。
--
-- 两个索引对应候选查询的两个分支。不用 OR（会退化成全表扫描），
-- 所以写成 UNION 两条 SQL，各走各的索引。

ALTER TABLE t_post
  ADD COLUMN view_count          INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计浏览，不精确（Redis 缓冲后回写）',
  ADD COLUMN share_count         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计分享',
  ADD COLUMN last_interaction_at DATETIME(3) NULL               COMMENT '最后一次互动时刻，热度的衰减基准',
  ADD KEY idx_status_created (status, created_at, id),
  ADD KEY idx_status_last_interaction (status, last_interaction_at, id);
