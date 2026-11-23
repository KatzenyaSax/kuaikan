package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

/**
 * 转让社群管理员（{@code POST /communities/{name}/transfer}，仅现任管理员）。
 *
 * 只有目标用户 id，没有"确认"之类的字段：二次确认是前端的事，
 * 后端拒绝的是"目标不合法"（自己、非在社成员、被封禁者 → 41009）。
 *
 * 用户 id 按字符串接收（JSON 里是雪花 id 字符串），与全站一致。
 */
public record TransferCommunityRequest(
        @NotNull(message = "必须指定转让对象")
        @Schema(type = "string", description = "新管理员用户 id")
        Long targetUserId
) {
}
