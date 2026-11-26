package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 对内私密笔记混合检索请求（P9.3）。
 */
public record InternalSearchNotesRequest(
        @Schema(type = "string", description = "笔记所属用户 ID，必填")
        String ownerId,
        @Schema(description = "检索查询文本，必填")
        String query,
        @Schema(description = "返回条数，默认 5，最大 8")
        Integer limit
) {
}
