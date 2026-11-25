package top.katzenyasax.kuaikan.ai.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ActionResultRequest(
        @NotBlank(message = "执行状态不能为空")
        @Pattern(regexp = "^(EXECUTED|FAILED|REJECTED)$", message = "非法状态")
        String status,

        @Size(max = 256)
        String resultRef,

        Integer errorCode
) {
}
