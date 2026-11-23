package top.katzenyasax.kuaikan.common.mq;

/**
 * 帖子删除事件（P6.0）。载荷对应 topic {@link Topics#POST_DELETED}。
 *
 * <b>生产方 content-service，消费方 search-service</b>。删帖只发 id：
 * 索引侧要做的是"把这个文档删掉"，多带任何字段都是噪音。
 *
 * <h2>为什么删帖要单独一个 topic</h2>
 *
 * 不能复用 {@link PostCreated} 加一个 {@code deleted} 标记：两个事件的**消费动作**
 * 完全不同（覆盖写 vs 删除文档），共用一个 topic 会让消费者先分支再处理，
 * 且新旧字段一旦不对称（删帖根本拿不到 title/body），载荷就退化成大半字段为 null 的联合体。
 *
 * <h2>为什么必须发删除事件</h2>
 *
 * ES 里没有"软删"可言：只删库不发事件的后果是**删掉的帖子还能被搜到**，
 * 而且点进去是 404 —— 这是搜索侧最刺眼的一类脏数据，无法靠 TTL 自愈。
 *
 * @param eventId    幂等唯一键。在写 outbox 的同一事务里生成，重投时保持不变
 * @param occurredAt epoch 毫秒。不用 Instant，避免两侧序列化配置不同
 * @param postId     被删帖子的 id。消费方按它删除 ES 文档，404 视为幂等成功
 */
public record PostDeleted(
        String eventId,
        long occurredAt,
        String postId
) {
}
