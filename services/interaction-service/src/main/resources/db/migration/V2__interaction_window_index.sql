-- P5：按时间窗口聚合互动的索引。
--
-- 现有的 idx_kind_target 前缀是 (kind, target_type, target_id, created_at, id)：
-- 它适合"某目标的全部互动"，但**不适合时间窗口聚合**——
-- target_id IN (...) 之后 created_at 已经无法用于范围过滤，
-- 每个目标的历史互动都会被扫一遍。
--
-- rank 要的是"最近 24h 的所有点赞/收藏，按帖子分组"，所以 created_at 必须在前：
--   WHERE kind = ? AND target_type = ? AND created_at >= ?
--   GROUP BY target_id
--
-- 这条索引让范围扫描只覆盖窗口内的行。

ALTER TABLE t_interaction
  ADD KEY idx_kind_type_created (kind, target_type, created_at, target_id);
