package top.katzenyasax.kuaikan.common.mq;

/**
 * 用户资料变更事件（P6.0）。载荷对应 topic {@link Topics#USER_PROFILE_UPDATED}。
 *
 * <b>生产方 user-service，消费方 search-service</b>。
 *
 * <h2>为什么它存在</h2>
 *
 * 索引里的 {@code authorNickname} 是从 {@code t_user} 反范式拷贝过去的。
 * 用户改昵称后，历史帖子的索引文档不会自己更新 —— 搜索结果里就会出现
 * "同一个作者在不同帖子下叫不同名字"。这是反范式的**必然代价**，
 * 所以要有一条专门的同步链路来还债：消费方按 {@code authorId}
 * 做 {@code _update_by_query} 批量改写。
 *
 * <h2>为什么只有 nickname 这一个字段</h2>
 *
 * 索引里没有头像、没有简介。**载荷只承诺索引真正需要的字段**：
 * 多带一个字段就等于承诺"以后改它也要发事件"，而消费方并没有地方用它。
 * 将来若索引里加了别的东西，再加字段（不兼容变更 = 新 topic）。
 *
 * <h2>为什么 id 是 String</h2>
 *
 * 同 {@link CommentCreated}：MQ 层与 web 层的 Long 序列化策略不同，统一用 String。
 *
 * @param eventId    幂等唯一键。在写 outbox 的同一事务里生成，重投时保持不变
 * @param occurredAt epoch 毫秒。不用 Instant，避免两侧序列化配置不同
 * @param userId     改了资料的用户 id，对应索引里的 {@code authorId}
 * @param nickname   新昵称快照。消费方直接写进 {@code authorNickname}，不回查
 */
public record UserProfileUpdated(
        String eventId,
        long occurredAt,
        String userId,
        String nickname
) {
}
