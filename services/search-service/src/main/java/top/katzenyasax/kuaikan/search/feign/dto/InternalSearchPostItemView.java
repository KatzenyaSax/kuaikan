package top.katzenyasax.kuaikan.search.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * content {@code GET /internal/search/posts} 的返回元素。search 侧的最小副本。
 *
 * <b>含完整 body</b>：重建要的是全文索引，不是摘要。
 * <b>不含 authorNickname / communityName</b>：那两个是反范式冗余，
 * 由本服务向 user / community 批量补齐（与事件路径保持一致）。
 */
public record InternalSearchPostItemView(
        @Schema(type = "string") Long postId,
        @Schema(type = "string") Long communityId,
        @Schema(type = "string") Long authorId,
        String title,
        String body,
        long createdAt
) {
}
