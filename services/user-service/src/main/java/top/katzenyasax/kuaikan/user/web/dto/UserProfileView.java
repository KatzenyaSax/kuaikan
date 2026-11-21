package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 用户主页的公开资料。**游客可读，所以只放公开字段。**
 *
 * 刻意不放的东西（与 {@link UserSummary} 同一纪律）：
 *   - email / passwordHash / roles / status —— 私有或可推断账号状态
 *   - "我是否关注 ta" —— 那是登录态信息，由前端并发调
 *     {@code GET /api/user/follows/states?userIds=} 聚合（p55-social.md §3.1）。
 *     把当前用户视角塞进本响应，会让这个端点变成"越权可读的私有状态源"。
 *
 * 计数是**派生值**（COUNT(*)，ADR 0010），不是 t_user 上的冗余列。
 */
public record UserProfileView(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long userId,
        String nickname,
        String avatarUrl,
        @Schema(description = "ta 关注了多少人")
        long followingCount,
        @Schema(description = "多少人关注 ta")
        long followerCount
) {
}
