package top.katzenyasax.kuaikan.user.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 修改密码（需登录）。目标用户只来自 UserContext，请求体里没有 userId。
 *
 * <b>newPassword 的校验规则与 {@link RegisterRequest#password()} 严格一致</b>
 * （8~72）：上限 72 是 BCrypt 的硬约束——它只取前 72 字节，
 * 超出部分被静默丢弃。两处的注解必须一起改，否则会出现
 * "注册时能设但改密时设不了"（或反过来）这类只在某一条路径上暴露的不一致。
 *
 * <b>oldPassword 也限 72</b>：存量密码都是按注册规则写进去的，
 * 超过 72 的输入不可能是正确的旧密码，提前挡掉比让它进 BCrypt 更清楚。
 */
public record ChangePasswordRequest(
        @NotBlank(message = "原密码不能为空")
        @Size(max = 72, message = "原密码过长")
        String oldPassword,

        @NotBlank(message = "新密码不能为空")
        @Size(min = 8, max = 72, message = "密码长度需在 8~72 之间")
        String newPassword
) {
}
