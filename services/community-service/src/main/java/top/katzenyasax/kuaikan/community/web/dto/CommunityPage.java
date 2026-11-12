package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 一页社群。{@code nextCursor} 为 null 表示没有下一页。
 *
 * 游标是**不透明字符串**，前端只做原样回传，不许解析、不许拼
 * （见 kuaikan-common 的 CursorCodec）。
 */
public record CommunityPage(
        List<CommunitySummary> items,
        @Schema(description = "下一页游标；为 null 表示已到末页")
        String nextCursor
) {
}
