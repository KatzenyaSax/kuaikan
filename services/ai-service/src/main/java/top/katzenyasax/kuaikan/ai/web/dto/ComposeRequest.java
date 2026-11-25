package top.katzenyasax.kuaikan.ai.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ComposeRequest(
        @NotBlank(message = "帮写模式不能为空")
        @Pattern(regexp = "^(EXPAND|POLISH|SHORTEN|RECOMMEND_COMMUNITY|REPLY)$",
                message = "不支持的帮写模式")
        String mode,

        @Size(max = 20000, message = "草稿过长")
        String draft,

        @Size(max = 32)
        String postId,

        @Size(max = 32)
        String commentId
) {
}
