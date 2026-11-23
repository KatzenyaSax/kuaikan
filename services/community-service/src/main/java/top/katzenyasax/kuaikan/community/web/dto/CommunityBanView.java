package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 生效中的封禁（管理页封禁名单 / 封禁接口的回显）。
 *
 * {@code expiresAt} 为 null 表示**永久封禁**——这与"没设置"同形，
 * 但在这个上下文里只有一种含义：`t_community_ban.expires_at IS NULL`。
 *
 * 名单里**只有生效中的封禁**：已解封和已自然过期的行不进列表
 * （要看历史请读 {@code /communities/{name}/history?category=moderation}）。
 */
public record CommunityBanView(
        @Schema(type = "string", description = "被封禁的用户 id")
        Long userId,
        @Schema(type = "string", description = "执行封禁的管理员用户 id")
        Long bannedBy,
        @Schema(description = "封禁原因；为 null 表示没填原因")
        String reason,
        LocalDateTime bannedAt,
        @Schema(description = "封禁到期时间；为 null 表示永久封禁")
        LocalDateTime expiresAt
) {
}
