package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.content.domain.Post;

import java.time.LocalDateTime;

/**
 * 帖子详情。
 *
 * **只有 authorId，没有作者昵称/头像**（ADR 0009）。前端用
 * {@code GET /api/user/users?ids=} 另行获取。
 *
 * 如果哪天有人想"顺手把 nickname 带回来"，先读 ADR 0009：
 * 那会让发帖这一步依赖 user-service 的存活。
 */
public record PostDetail(
        @Schema(type = "string", description = "雪花 id")
        Long id,
        @Schema(type = "string", description = "社群 id")
        Long communityId,
        @Schema(type = "string", description = "作者 id，昵称头像需另行批量获取")
        Long authorId,
        String title,
        String body,
        LocalDateTime createdAt
) {
    public static PostDetail of(Post post) {
        return new PostDetail(post.getId(), post.getCommunityId(), post.getAuthorId(),
                post.getTitle(), post.getBody(), post.getCreatedAt());
    }
}
