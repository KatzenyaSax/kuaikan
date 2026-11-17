package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.content.domain.Comment;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 一条评论。一级评论与回复共用同一个结构。
 *
 * {@code deleted} 为 true 时 {@code body} 是空串、{@code authorId} 仍在——
 * 前端渲染成"该评论已删除"，但它的回复仍然挂在下面。
 * 之所以不直接 404 掉整条，是因为 tombstone 的意义就是"位置还在"。
 *
 * 没有作者昵称/头像（ADR 0009），前端用批量摘要接口现取。
 */
public record CommentView(
        @Schema(type = "string", description = "雪花 id")
        Long id,
        @Schema(type = "string", description = "帖子 id") Long postId,
        @Schema(type = "string", description = "所属一级评论 id；一级评论为 null")
        Long rootCommentId,
        @Schema(type = "string", description = "直接回复的评论 id；一级评论为 null")
        Long replyToCommentId,
        @Schema(type = "string", description = "直接回复的用户 id；一级评论为 null")
        Long replyToUserId,
        @Schema(type = "string", description = "作者 id") Long authorId,
        String body,
        long likeCount,
        @Schema(description = "该一级评论下的全部可见回复数")
        long replyCount,
        boolean deleted,
        @Schema(description = "解析成功并被 @ 的用户；未解析到的 @ 不在这里，前端按普通文字渲染")
        List<MentionView> mentions,
        LocalDateTime createdAt
) {
    /** 不带 @ 的版本。迁移期与不关心提及的调用方用 */
    public static CommentView of(Comment c) {
        return of(c, List.of());
    }

    /**
     * @param mentions 由 {@code MentionResolver} 从 {@code c.getMentions()} 的 JSON 反解出来。
     *                 放在参数里而不是在这里反解，是因为 View 不该依赖 ObjectMapper。
     */
    public static CommentView of(Comment c, List<MentionView> mentions) {
        boolean deleted = c.getStatus() != null && c.getStatus() == Comment.STATUS_DELETED;
        return new CommentView(
                c.getId(), c.getPostId(), c.getRootCommentId(), c.getReplyToCommentId(),
                c.getReplyToUserId(), c.getAuthorId(),
                deleted ? "" : c.getBody(),
                c.getLikeCount() == null ? 0 : c.getLikeCount(),
                c.getReplyCount() == null ? 0 : c.getReplyCount(),
                deleted,
                // tombstone 的正文已经清空，@ 也没有意义了
                deleted ? List.of() : mentions,
                c.getCreatedAt());
    }
}
