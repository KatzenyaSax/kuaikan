package top.katzenyasax.kuaikan.common.mq;

/**
 * 帖子发布事件（P6.0）。载荷对应 topic {@link Topics#POST_CREATED}。
 *
 * <b>生产方 content-service，消费方 search-service</b>：搜索索引是 content 的读模型，
 * 由 content 在发帖成功的**同一本地事务**里追加一条 outbox 记录，再由 relay 投递。
 * ES 挂了只影响"能不能被搜到"，不影响发帖本身（不变量：主链路不依赖派生存储）。
 *
 * <h2>为什么 body 整个进载荷</h2>
 *
 * 消费者要建的是全文索引，摘要/高亮都在 ES 侧做。若载荷只给 postId，
 * search-service 就要回查 content 拿正文 —— 那一跳会把索引延迟绑在
 * content 的健康度上，且帖子随后被编辑时事件与回查结果可能对不上。
 * 快照进载荷让事件自包含（同 {@link CommentCreated} 的 excerpt 原则）。
 *
 * <h2>为什么没有 communityName / authorNickname</h2>
 *
 * 这两个是**反范式冗余**，由 search-service 通过 community/user 的内部接口拉取。
 * content 不是它们的所有者，写进载荷意味着发帖路径要跨服务调用，
 * 而"能不能发出去"不该由别人的健康度决定。
 *
 * <h2>为什么 id 一律 String</h2>
 *
 * 同 {@link CommentCreated}：web 层 ObjectMapper 把 Long 序列化成 String（JacksonConfig），
 * MQ 层不用那个配置，同一种 Long 在两处类型不同，而反序列化失败只在运行时暴露。
 *
 * @param eventId     幂等唯一键。在写 outbox 的同一事务里生成，重投时保持不变
 * @param occurredAt  epoch 毫秒。不用 Instant，避免两侧序列化配置不同
 * @param postId      帖子 id，同时作为 ES 文档 {@code _id}，覆盖写天然幂等
 * @param communityId 所属社群。索引里用于社群筛选
 * @param authorId    作者。用户改昵称时要按它 {@code _update_by_query} 同步历史文档
 * @param title       标题快照
 * @param body        正文快照（已过审核的最终文本）
 * @param createdAt   发帖时间，epoch 毫秒，映射到 ES 的 {@code createdAt: date}
 */
public record PostCreated(
        String eventId,
        long occurredAt,
        String postId,
        String communityId,
        String authorId,
        String title,
        String body,
        long createdAt
) {
}
