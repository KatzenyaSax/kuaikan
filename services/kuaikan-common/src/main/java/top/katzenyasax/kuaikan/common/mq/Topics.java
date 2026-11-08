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

    private Topics() {
    }
}
