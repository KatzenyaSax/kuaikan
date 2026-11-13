package top.katzenyasax.kuaikan.common.mq;

/**
 * 消息 topic 契约。命名规则见 architecture §6：kuaikan_{domain}_{event}
 *
 * 注意 RocketMQ 的 topic 校验正则是 ^[%|a-zA-Z0-9_-]+$ —— **不允许点号**，
 * 所以用下划线而不是 "." 分隔，`kuaikan.content.post_created` 这种写法会直接抛
 * MQClientException: contains illegal characters。
 *
 * 放在 common 是因为它是**跨服务契约**，与 Services 同一性质；
 * 注意这不是业务代码，不违反「common 只放非业务」的纪律。
 */
public final class Topics {

    /** P0 冒烟专用 topic，P3 起由真实的领域事件取代 */
    public static final String P0_SMOKE = "kuaikan_p0_smoke";

    /**
     * 点赞 / 收藏的加与取消。载荷见 {@link InteractionChange}。
     *
     * <b>为什么点赞和收藏共用一个 topic</b>：它们的消费边界相同
     * （content 两者都消费、notification 只消费 LIKE+ADDED），
     * 拆成两个 topic 只会让消费方多订阅一份、几乎没有收益。
     * 区分靠载荷里的 {@code kind}。
     *
     * <b>为什么"加"和"取消"也共用一个 topic</b>：同上。区分靠 {@code change}。
     * 若以后取消事件要触发完全不同的下游行为，再拆不迟——那时才真有收益。
     *
     * <b>不兼容变更 = 新 topic</b>，新旧并行一段时间。消息没有版本化机制，
     * 不要试图在旧 topic 上改字段。
     */
    public static final String INTERACTION_CHANGED = "kuaikan_interaction_changed";

    private Topics() {
    }
}
