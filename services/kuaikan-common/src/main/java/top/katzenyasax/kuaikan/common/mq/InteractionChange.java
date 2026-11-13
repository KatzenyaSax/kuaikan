package top.katzenyasax.kuaikan.common.mq;

/**
 * 互动变更事件（点赞 / 收藏的加与取消）。
 *
 * <b>这是跨服务契约，放在 common 里是有意的。</b>
 * 生产者（interaction-service）和消费者（content-service，以及 P4 的
 * notification-service）必须对字段**完全一致**；共享同一个 record 能让
 * 任何一侧的改动在**编译期**就炸出来，而不是等运行时 JSON 对不上。
 * 这与 P2.3 的 {@code MembershipView} 刻意不复用不同：那是"我理解的你"（领域视图），
 * 这是"我们共同遵守的契约"。
 *
 * <h2>为什么字段类型大多是 String</h2>
 *
 * id 都是雪花 Long。但 JSON 序列化在两类进程里用的 ObjectMapper **不是同一个**：
 * web 层有 JacksonConfig（Long → String），MQ 序列化用的是 RocketMQ 自带的，
 * 不受那个配置影响。同一个 Long 在两处会被序列化成不同类型，
 * 而消费端反序列化失败是**运行时**才暴露的。
 *
 * 所以事件载荷里的 id 一律用 String：序列化结果与 ObjectMapper 配置无关，
 * 消费端自己 Long.parseLong。代价是一行转换，换来的是不再有这个隐蔽的坑。
 *
 * <h2>不可变</h2>
 *
 * 事件是**过去发生的事实**，不可修改。不兼容的变更只有一条路：新增 topic，
 * 新旧并行一段时间（P3 没有消息版本化机制，加 v 字段也没人去用它，
 * 只会给人"有版本化"的错觉）。
 *
 * @param eventId       幂等唯一键。**在写 outbox 的同一事务里生成，重投时保持不变** ——
 *                      这是幂等成立的前提：换了 id 就等于换了一个事件，重复消费无从识别
 * @param occurredAt    epoch 毫秒。不用 Instant：避免两侧序列化配置不同导致格式不一致
 * @param change        ADDED / REMOVED
 * @param kind          LIKE / FAVORITE。P4 的 notification 只消费 LIKE + ADDED
 *                      （收藏是私密行为，不发消息）
 * @param actorId       操作者
 * @param targetType    POST / COMMENT
 * @param targetId      被点赞/收藏的对象
 * @param targetOwnerId 目标作者的 id。content 侧用不到，但 P4 的"有人赞了你"需要它；
 *                      现在不带，以后就只能换 topic。它由 interaction 调 content 的
 *                      内部接口取得
 */
public record InteractionChange(
        String eventId,
        long occurredAt,
        Change change,
        Kind kind,
        String actorId,
        TargetType targetType,
        String targetId,
        String targetOwnerId
) {

    /** 事实的方向。取消不是"修改"，是"另一件事" */
    public enum Change { ADDED, REMOVED }

    /** 互动种类。收藏与点赞共用一条管道，只是语义不同（收藏不发消息、不计热度） */
    public enum Kind { LIKE, FAVORITE }

    /** 被作用的对象类型 */
    public enum TargetType { POST, COMMENT }
}
