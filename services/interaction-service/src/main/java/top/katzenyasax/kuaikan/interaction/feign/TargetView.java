package top.katzenyasax.kuaikan.interaction.feign;

/**
 * content-service 内部接口 GET /internal/targets 的返回体。
 *
 * 与 content 里对应的 record 结构一致，但**刻意不复用同一个类**：
 * 那是 content 的领域对象，这里是 interaction 侧对"下游契约"的独立描述。
 * 共用会让人误以为改动可以随意穿透服务边界。
 * （MQ 事件是另一回事——那是双向契约，所以放 common 共享。）
 */
public record TargetView(boolean exists, String ownerId) {
}
