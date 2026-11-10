package top.katzenyasax.kuaikan.user.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        @Size(max = 254, message = "邮箱过长")
        String email,

        @NotBlank(message = "密码不能为空")
        @Size(max = 72, message = "密码长度不合法")
        String password
) {
}
