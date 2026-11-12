package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 发帖。
 *
 * **没有 authorId 字段**：作者永远是网关注入的 UserContext。
 * 客户端能传的只有"发到哪个社群"和内容本身。
 *
 * 长度上限两侧必须一致（这里与前端 maxLength 是同一个数字）：
 *   title 1~120，body 1~20000。
 * 上限不是随便定的：它决定了一次请求体的最大体积，网关和 nginx 的
 * body 限制都要跟着它走。
 */
public record CreatePostRequest(
        @NotNull(message = "必须指定社群")
        @Schema(type = "string", description = "社群 id")
        Long communityId,

        @NotBlank(message = "标题不能为空")
        @Size(max = 120, message = "标题不能超过 120 字")
        String title,

        @NotBlank(message = "正文不能为空")
        @Size(max = 20000, message = "正文不能超过 20000 字")
        String body
) {
}
