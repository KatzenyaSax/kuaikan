package top.katzenyasax.kuaikan.user.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 注册请求。
 *
 * 密码上限 72 是硬约束：BCrypt 只取前 72 字节，超出部分会被静默丢弃。
 * 不校验的话，用户以为自己设了一个长密码，实际只有前 72 字节生效。
 */
public record RegisterRequest(
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        @Size(max = 254, message = "邮箱过长")
        String email,

        @NotBlank(message = "密码不能为空")
        @Size(min = 8, max = 72, message = "密码长度需在 8~72 之间")
        String password,

        @NotBlank(message = "昵称不能为空")
        @Size(min = 2, max = 32, message = "昵称长度需在 2~32 之间")
        String nickname,

        @NotBlank(message = "验证码不能为空")
        @Pattern(regexp = "\\d{6}", message = "验证码为 6 位数字")
        String code
) {
}
