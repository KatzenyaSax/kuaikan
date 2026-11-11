package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

/**
 * 运维动作的目标用户。
 *
 * userId 收字符串：雪花 ID 序列化就是字符串（全局 Long→String），
 * 前端/脚本传字符串更一致，避免"传数字丢精度"这类问题。
 */
public record AdminUserRequest(
        @NotNull(message = "userId 不能为空")
        @Schema(type = "string", description = "目标用户 ID")
        String userId,
        String reason
) {
}
