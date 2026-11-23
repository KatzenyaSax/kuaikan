package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 成员列表项（管理页）。
 *
 * 只有 userId —— 昵称与头像不在这个服务的库里。前端拿这批 id 走
 * {@code GET /api/user/users?ids=} 批量补齐（ADR 0005：读路径零跨服务调用，
 * 由前端合并，而不是 community-service 同步调 user-service）。
 *
 * {@code admin} 由 {@code t_community.owner_id} 推导，不是成员行的 role 列：
 * P7 是单管理员制，role 列没有写入者（p7-community-admin.md §1.1）。
 */
public record CommunityMemberView(
        @Schema(type = "string", description = "成员用户 id")
        Long userId,
        LocalDateTime joinedAt,
        @Schema(description = "是否为当前管理员")
        boolean admin
) {
}
