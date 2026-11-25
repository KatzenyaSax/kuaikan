package top.katzenyasax.kuaikan.ai.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SendMessageRequest(
        @NotBlank(message = "消息内容不能为空")
        @Size(max = 4000, message = "消息内容不能超过 4000 字")
        String content,
        @Size(max = 32)
        String intent,
        @Valid
        PageContextDto pageContext
) {
}
