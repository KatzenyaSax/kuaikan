package top.katzenyasax.kuaikan.user.web.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 修改自己的资料。**部分更新**：字段为 null 表示"不改"。
 *
 * 关于"清空头像"：JSON 里 null 与"字段缺失"在 Jackson 反序列化后都是 null，
 * 无法区分。所以约定 **空字符串表示清空**，不传表示不改。
 * 昵称不允许空（它是必填项，没有"清空昵称"这回事）。
 */
public record UpdateProfileRequest(
        @Size(min = 2, max = 32, message = "昵称长度需在 2~32 之间")
        String nickname,

        @Size(max = 255, message = "头像地址过长")
        @Pattern(regexp = "^$|^https?://.+", message = "头像地址必须是 http(s) 链接")
        String avatarUrl
) {
}
