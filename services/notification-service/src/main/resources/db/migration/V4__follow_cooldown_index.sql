-- FOLLOW 消息的 24h 同人冷却判定索引（P5.5.1）。
--
-- 判定语句（MessageMapper#existsRecentFollow）：
--   SELECT 1 FROM t_message
--   WHERE user_id = ? AND type = 'FOLLOW' AND actor_id = ? AND created_at > ? LIMIT 1
--
-- 四列顺序与 WHERE 完全一致：等值三列 + 范围一列，索引定位到 (user_id, type, actor_id)
-- 后只扫这一小段 created_at，命中即返回。
--
-- 为什么冷却状态放 MySQL 而不是 Redis：
--   与「未读计数不用 Redis 计数器」同一哲学（p4-notification.md §6.5）——
--   notification-service 的事实全在 MySQL，加一条联合索引就是毫秒级判定；
--   引入 Redis 反而多一个会丢状态的依赖（重启即丢冷却窗口）。

ALTER TABLE t_message
  ADD KEY idx_follow_cooldown (user_id, type, actor_id, created_at);
