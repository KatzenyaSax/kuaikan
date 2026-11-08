package top.katzenyasax.kuaikan.common.mq;

/**
 * 消息 topic 契约。命名规则见 architecture §6：kuaikan.{domain}.{event}
 *
 * 放在 common 是因为它是**跨服务契约**，与 Services 同一性质；
 * 注意这不是业务代码，不违反「common 只放非业务」的纪律。
 */
public final class Topics {

    /** P0 冒烟专用 topic，P3 起由真实的领域事件取代 */
    public static final String P0_SMOKE = "kuaikan.p0.smoke";

    private Topics() {
    }
}
