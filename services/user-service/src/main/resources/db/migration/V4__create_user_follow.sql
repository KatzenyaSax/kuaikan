-- t_user_follow：关注关系（P5.5.1）。
--
-- **不在 t_user 上冗余 following_count / follower_count**（ADR 0010：计数是派生状态，能算就别存）：
--   - 下面两条联合索引正好覆盖「某人关注了谁」「谁关注了某人」的 COUNT(*)，纯索引扫描；
--   - 省掉双写、并发竞态（点赞数那种漂移）与对账任务。
-- 1 万注册用户 / 单人关注上限 200 的规模下，"算"比"存"更省心。

CREATE TABLE t_user_follow (
  id           BIGINT UNSIGNED NOT NULL,
  follower_id  BIGINT UNSIGNED NOT NULL COMMENT '关注者',
  followee_id  BIGINT UNSIGNED NOT NULL COMMENT '被关注者',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 幂等第一层：同一对 (关注者, 被关注者) 只能有一行。
  -- 配合 INSERT IGNORE 的 affectedRows，重复关注根本不会产生第二个 UserFollowed 事件。
  UNIQUE KEY uk_follower_followee (follower_id, followee_id),
  -- 关注列表 / 我的关注数：WHERE follower_id = ? ORDER BY created_at DESC, id DESC
  KEY idx_follower_created (follower_id, created_at, id),
  -- 粉丝列表 / 粉丝数：WHERE followee_id = ? ORDER BY created_at DESC, id DESC
  KEY idx_followee_created (followee_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户关注关系';

-- 取关是**物理删除**，不是逻辑删除：接口语义是「设为未关注」，
-- 「有没有这一行」就是唯一的事实（与 t_interaction 取消点赞一致）。
-- 逻辑删除还得为唯一键写复活逻辑，而"关注历史"对业务没有用处。
