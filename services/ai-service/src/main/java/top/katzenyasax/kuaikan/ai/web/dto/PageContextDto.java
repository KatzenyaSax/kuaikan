package top.katzenyasax.kuaikan.ai.web.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 当前页面上下文标识：只接收枚举类型与 ID/名称标识，绝不接收页面正文。
 */
public record PageContextDto(
        @Pattern(regexp = "^(POST|COMMUNITY|HOME|SEARCH|USER|OTHER)$", message = "页面类型不合法")
        String type,
        @Size(max = 32)
        String postId,
        @Size(max = 64)
        String communityName,
        @Size(max = 32)
        String userId
) {
}
