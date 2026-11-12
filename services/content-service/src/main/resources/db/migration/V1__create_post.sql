-- 帖子。
--
-- P2.3 只建这一张表。刻意**不含计数列**（like_count / comment_count /
-- favorite_count / view_count）：
--   * P2 阶段没有任何写入者，建了就是四个恒为 0 的死列
--   * 口径还没定（comment_count 含不含 tombstone 占位？view_count 怎么去重？），
--     现在写下的默认值大概率是错的
--   * MySQL 8 的 ALGORITHM=INSTANT 加列是元数据操作，百万行也是秒级
--   * 响应形状已经稳了：文档已定「计数为 0 不显示」，P3 加字段是纯增量
--
-- 也**不含任何作者信息列**（昵称/头像）：那些由前端用
-- GET /api/user/users?ids= 现取（ADR 0009）。存快照会让发帖依赖
-- user-service 的同步可用性。
--
-- 也没有 slug：帖子用 id 做 URL（/c/{社群名}/p/{id}）。标题会变、会重复、
-- 会很长，把它放进 URL 只会带来 slug 的所有麻烦却没有社群名那种收益。

CREATE TABLE t_post (
  id            BIGINT UNSIGNED NOT NULL           COMMENT '雪花 id',
  community_id  BIGINT UNSIGNED NOT NULL           COMMENT '所属社群；跨服务引用，无外键（ADR 0006）',
  author_id     BIGINT UNSIGNED NOT NULL           COMMENT '作者；来自网关注入的 UserContext',
  title         VARCHAR(120) NOT NULL              COMMENT '标题，纯文本',
  body          MEDIUMTEXT   NOT NULL              COMMENT '正文，纯文本，允许换行',
  status        TINYINT NOT NULL DEFAULT 1         COMMENT '1 正常 / 0 已删除 / 2 待审核(P7) / 3 已隐藏(P7)',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- 社群时间线的唯一热查询：
  --   WHERE community_id=? AND status=1 AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC
  -- 等值列在前、排序列在后，行值比较能走这条索引
  KEY idx_community_created (community_id, status, created_at, id),
  -- P4 的「我的帖子」用。现在就建是因为：建索引比加列贵得多
  -- （大表上是真正的 rebuild，INSTANT 用不上），而它的规划是明确的，不是猜测
  KEY idx_author_created (author_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='帖子';
