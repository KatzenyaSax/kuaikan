package top.katzenyasax.kuaikan.rank.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/** content `GET /internal/rank/candidates` 的返回元素。rank 侧的最小副本 */
public record RankCandidateView(
        @Schema(type = "string") Long postId,
        String title,
        @Schema(type = "string") Long authorId,
        @Schema(type = "string") Long communityId,
        long likeCount,
        long favoriteCount,
        long commentCount,
        long viewCount,
        long shareCount,
        long recentCommentCount,
        LocalDateTime lastInteractionAt,
        LocalDateTime createdAt
) {
}
