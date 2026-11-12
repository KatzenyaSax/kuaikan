package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.content.domain.Post;

import java.time.LocalDateTime;

/**
 * 列表项。**刻意不含 body** —— 一屏 20 条帖子各带一篇正文，响应体会膨胀几十倍，
 * 而列表页只显示标题。正文在详情接口里取。
 *
 * 也没有作者昵称/头像（ADR 0009），前端用批量摘要接口现取。
 */
public record PostSummary(
        @Schema(type = "string", description = "雪花 id")
        Long id,
        @Schema(type = "string", description = "社群 id")
        Long communityId,
        @Schema(type = "string", description = "作者 id")
        Long authorId,
        String title,
        LocalDateTime createdAt
) {
    public static PostSummary of(Post post) {
        return new PostSummary(post.getId(), post.getCommunityId(), post.getAuthorId(),
                post.getTitle(), post.getCreatedAt());
    }
}
