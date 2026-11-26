package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 帖子页「相关帖子」推荐条目（P9.1）。
 */
public record RelatedPostItem(
        @Schema(type = "string", description = "帖子 ID")
        String postId,
        @Schema(type = "string", description = "社群 ID")
        String communityId,
        String communityName,
        @Schema(type = "string", description = "作者 ID")
        String authorId,
        String authorNickname,
        String title,
        long createdAt,
        double score
) {
}
