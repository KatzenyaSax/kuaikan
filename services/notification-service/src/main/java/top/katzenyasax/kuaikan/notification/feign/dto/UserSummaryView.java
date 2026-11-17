package top.katzenyasax.kuaikan.notification.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * user-service 的作者摘要，notification 侧的最小副本。
 *
 * 刻意不复用远端 DTO（同 P2.3 的 {@code MembershipView}）：
 * 这是"我理解的你"，不是共同契约。
 */
public record UserSummaryView(
        @Schema(type = "string") Long userId,
        String nickname,
        String avatarUrl
) {
}
