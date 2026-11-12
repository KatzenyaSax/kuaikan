package top.katzenyasax.kuaikan.community.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 建社群。只有名字和简介两个字段——**没有 slug**。
 *
 * 用户建社群时脑子里只有"叫什么"，让他再想一个全站唯一的 ASCII 字符串是纯摩擦。
 * 名称会由服务端规范化成 name_key 作为 URL 与唯一键（见 NameKeys）。
 *
 * **字符集校验不在这里**，而在 CommunityService 里对 name_key 做。
 * 原因：如果在校验原始名称时就只允许 ASCII 字母，那么全角输入（"ＡＢＣ"，
 * 中文输入法下极常见）会先被拒——于是 NFKC 规范化永远用不上，成了死代码。
 * 校验必须发生在规范化**之后**，全角才能被接受并折叠成半角。
 */
public record CreateCommunityRequest(
        @NotBlank(message = "社群名不能为空")
        @Size(min = 2, max = 32, message = "社群名长度需在 2~32 之间")
        String name,

        @Size(max = 500, message = "简介不能超过 500 字")
        String description
) {
}
