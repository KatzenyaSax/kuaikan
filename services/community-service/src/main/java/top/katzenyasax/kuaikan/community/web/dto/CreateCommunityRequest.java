package top.katzenyasax.kuaikan.community.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 建社群。只有名字和简介两个字段——**没有 slug**。
 *
 * 用户建社群时脑子里只有"叫什么"，让他再想一个全站唯一的 ASCII 字符串是纯摩擦。
 * 名称会由服务端规范化成 name_key 作为 URL 与唯一键（见 NameKeys）。
 */
public record CreateCommunityRequest(
        @NotBlank(message = "社群名不能为空")
        @Size(min = 2, max = 32, message = "社群名长度需在 2~32 之间")
        @Pattern(regexp = "^[\\p{IsHan}A-Za-z0-9 _-]+$",
                message = "社群名只能包含中文、字母、数字、空格、下划线和连字符")
        String name,

        @Size(max = 500, message = "简介不能超过 500 字")
        String description
) {
}
