-- 回复类消息的跳转锚点需要"展开哪个 root"。
--
-- 问题：评论区是两级平铺的，回复默认折叠在「展开 N 条回复」里。
-- 消息指向一条回复时，前端找不到那个 DOM 节点，只能停在帖子页。
--
-- 解法：把 root 一起存下来，前端先点开那个 root 的回复列表再滚过去。
--
-- 为什么不在前端反推：要反推就得先拉全部评论再逐条找，那是 O(n) 次请求。

ALTER TABLE t_message
  ADD COLUMN root_comment_id BIGINT UNSIGNED NULL
    COMMENT '回复所在的一级评论 id；顶层评论与非评论类消息为空' AFTER comment_id;
