package top.katzenyasax.kuaikan.content.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * user-service 的作者摘要，content 侧的最小副本。
 *
 * 刻意不复用远端 DTO（与 P2.3 的 {@code MembershipView} 同理）：
 * 这是"我理解的你"，不是共同契约。远端加字段不需要我跟着改，
 * 我需要的字段没了才会在编译期/反序列化期暴露。
 */
public record UserSummaryView(
        @Schema(type = "string") Long userId,
        String nickname,
        String avatarUrl
) {
}
