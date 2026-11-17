package top.katzenyasax.kuaikan.notification.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.notification.domain.Message;

import java.time.LocalDateTime;

/**
 * 一条消息。
 *
 * <b>不含文案。</b>后端只给结构化字段，前端拼"林间 赞了你的《…》"。
 * 理由：文案是展示层的事，改措辞不该动后端、不该发版、不该改接口。
 * 同一份数据在不同端（Web / 以后的 App）也可以有不同措辞。
 *
 * 所有 id 都是 Long → 由全局 Jackson 序列化成字符串（避免 JS 精度丢失）。
 */
public record MessageView(
        @Schema(type = "string") Long id,
        @Schema(description = "LIKE / COMMENT / MENTION / SYSTEM") String type,
        @Schema(type = "string", description = "动作发起人；SYSTEM 为 null") Long actorId,
        @Schema(description = "写入时的昵称快照，不会是当前昵称") String actorNickname,
        String actorAvatar,
        @Schema(description = "POST / COMMENT；SYSTEM 为 null") String targetType,
        @Schema(type = "string") Long targetId,
        @Schema(description = "帖子标题快照；目标已删除时可能为 null") String targetTitle,
        @Schema(description = "社群名快照，用于拼跳转 URL；为 null 表示点不进去") String communityName,
        @Schema(type = "string", description = "落点帖子 id") Long postId,
        @Schema(type = "string", description = "滚动锚点；点赞帖子时为 null") Long commentId,
        @Schema(type = "string", description = "回复所在的一级评论 id，前端先展开它再滚") Long rootCommentId,
        @Schema(description = "评论/正文摘录快照") String excerpt,
        @Schema(description = "已读时间；null 表示未读") LocalDateTime readAt,
        LocalDateTime createdAt
) {
    public static MessageView of(Message m) {
        return new MessageView(
                m.getId(), m.getType(),
                m.getActorId(), m.getActorNickname(), m.getActorAvatar(),
                m.getTargetType(), m.getTargetId(), m.getTargetTitle(),
                m.getCommunityName(), m.getPostId(), m.getCommentId(), m.getRootCommentId(),
                m.getExcerpt(),
                m.getReadAt(), m.getCreatedAt());
    }
}
