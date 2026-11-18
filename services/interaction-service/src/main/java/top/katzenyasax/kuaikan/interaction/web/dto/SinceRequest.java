package top.katzenyasax.kuaikan.interaction.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 「这些目标在 since 之后新增了多少互动」。
 *
 * <b>为什么用 POST + body 而不是 GET + query</b>：
 * 一次要传上百个 targetId，塞进 query string 会撞 Tomcat 的请求头上限
 * （P3 已经为此把批量上限从 500 砍到 200）。走 body 就没有这个限制，
 * 而且 rank 重建本来就不是"可缓存的 GET"。
 */
public record SinceRequest(
        @Schema(description = "targetType：POST 或 COMMENT", example = "POST")
        String targetType,
        @Schema(description = "窗口起点，epoch 毫秒", example = "1794900000000")
        long since,
        @Schema(description = "要查的目标 id 列表")
        List<String> targetIds
) {
}
