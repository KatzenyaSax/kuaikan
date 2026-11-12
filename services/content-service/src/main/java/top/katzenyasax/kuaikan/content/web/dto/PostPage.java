package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 一页帖子。{@code nextCursor} 为 null 表示没有下一页。
 *
 * 游标是**不透明字符串**，前端只做原样回传，不许解析、不许拼。
 */
public record PostPage(
        List<PostSummary> items,
        @Schema(description = "下一页游标；为 null 表示已到末页")
        String nextCursor
) {
}
