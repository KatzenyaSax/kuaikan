package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 对内私密笔记混合检索结果条目（P9.3）。
 */
public record InternalSearchNoteItem(
        @Schema(type = "string", description = "笔记 ID")
        String noteId,
        String title,
        String snippet,
        double score,
        long updatedAt
) {
}
