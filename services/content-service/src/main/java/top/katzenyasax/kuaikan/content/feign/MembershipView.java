package top.katzenyasax.kuaikan.content.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;

/**
 * community-service 内部接口 GET /internal/memberships 的返回体。
 *
 * 与 community-service 里的 MembershipResponse 结构一致，但**刻意不复用同一个类**：
 * 那是 community 的领域对象，这里是 content 侧对"下游契约"的独立描述。
 * 共用会让人误以为改动可以随意穿透服务边界。
 *
 * <h2>字段是"追加"出来的，必须容忍下游缺字段</h2>
 *
 * P2 只有 exists / member / role；P7.1 在尾部追加了 admin / banned /
 * banReason / bannedUntil。滚动发布期间（community-service 先发或后发）
 * 两侧一定会短暂不同步，所以这里：
 *   - 用原始 {@code boolean}：下游没这个字段时 Jackson 直接给 {@code false}，
 *     语义上恰好等于"不是管理员 / 没被封禁"，不需要额外兜底
 *   - 用 {@link JsonIgnoreProperties}(ignoreUnknown = true)：下游以后再追加字段，
 *     content 侧不会因为"多了一个不认识的键"整条链路炸掉
 *
 * {@code bannedUntil} 的时间类型刻意与 community-service 一致，用
 * {@link LocalDateTime}（不是 Instant）：对方发的是本地时间字符串，用 Instant
 * 反序列化会在缺少时区信息时直接抛。为 null 且 {@code banned} 为 true
 * 表示**永久封禁**——拼提示文案时要靠这一点区分「封到某天」和「永久」。
 *
 * 状态组合的不变量（由 community-service 保证，这里只是使用者）：
 *   - {@code admin=true} ⇒ {@code member=true, banned=false}
 *   - {@code banned=true} ⇒ {@code member=false}（封禁必须赢，哪怕成员行脏了）
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MembershipView(
        boolean exists,
        boolean member,
        Integer role,
        boolean admin,
        boolean banned,
        String banReason,
        LocalDateTime bannedUntil
) {
}
