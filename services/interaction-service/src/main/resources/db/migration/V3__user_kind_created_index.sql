-- P5.5.3：我的收藏列表的覆盖索引。
--
-- 查询形状（docs/design/p55-social.md §3.5 / §5.3）：
--   WHERE user_id = ? AND kind = 2 AND target_type = 1
--   ORDER BY created_at DESC, id DESC
--
-- 现有两条索引都用不上：
--   uk_user_kind_target (user_id, kind, target_type, target_id) —— 等值前缀命中，
--     但 target_id 之后没有 created_at，排序要额外 filesort，且必须回表取 created_at；
--   idx_kind_target (kind, target_type, target_id, created_at, id) —— 首列是 kind，
--     查"我的收藏"时 user_id 无法参与定位，扫的是全站收藏。
--
-- 新索引把 (user_id, kind, target_type) 三个等值列放在最前，后面紧跟排序键
-- (created_at, id)：等值前缀 + 有序尾巴 = 直接按索引顺序取 LIMIT 条，
-- 零 filesort，而且 created_at / id 都在索引里，需要的列也全在其中。
--
-- 不加 status 之类的过滤列：收藏这张表里「有没有这一行」就是唯一事实（取消是物理删）。

ALTER TABLE t_interaction
  ADD KEY idx_user_kind_created (user_id, kind, target_type, created_at, id);
