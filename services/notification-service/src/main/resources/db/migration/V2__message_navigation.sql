-- 消息要能"点进去"：增加跳转所需的字段。
--
-- 为什么不在读的时候现查：
--   读消息时要拼 `/c/{社群名}/p/{帖子id}#comment-{id}`，
--   而社群名只有 community-service 有。若在读路径上解析，翻一页消息就要
--   跨服务调 N 次——违反不变量 2（读路径禁止跨服务同步调用）。
--   消息是快照（不变量 9），跳转目标本来就是"当时那个帖子"，一起固化最自然。
--
-- 三个字段的含义：
--   community_name  社群名。**创建后不可改**（它就是 URL），所以快照永久有效
--   post_id         落点帖子
--   comment_id      滚动锚点；点赞帖子时为 NULL
--
-- 全部可空：V1 时期写入的 130 条消息没有这些信息，回填不了（当初没存）。

ALTER TABLE t_message
  ADD COLUMN community_name VARCHAR(64) NULL COMMENT '社群名快照，用于拼跳转 URL' AFTER target_title,
  ADD COLUMN post_id        BIGINT UNSIGNED NULL COMMENT '落点帖子 id' AFTER community_name,
  ADD COLUMN comment_id     BIGINT UNSIGNED NULL COMMENT '滚动锚点；点赞帖子时为 NULL' AFTER post_id;
