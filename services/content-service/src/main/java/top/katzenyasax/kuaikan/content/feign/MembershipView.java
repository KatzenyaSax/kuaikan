package top.katzenyasax.kuaikan.content.feign;

/**
 * community-service 内部接口 GET /internal/memberships 的返回体。
 *
 * 与 community-service 里的 MembershipResponse 结构一致，但**刻意不复用同一个类**：
 * 那是 community 的领域对象，这里是 content 侧对"下游契约"的独立描述。
 * 共用会让人误以为改动可以随意穿透服务边界。
 */
public record MembershipView(boolean exists, boolean member, Integer role) {
}
