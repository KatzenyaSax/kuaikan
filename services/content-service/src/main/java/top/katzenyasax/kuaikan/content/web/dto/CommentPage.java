package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/** 一页评论。按时间正序；nextCursor 为 null 表示没有下一页 */
public record CommentPage(
        List<CommentView> items,
        @Schema(description = "下一页游标；为 null 表示已到末页")
        String nextCursor
) {
}
