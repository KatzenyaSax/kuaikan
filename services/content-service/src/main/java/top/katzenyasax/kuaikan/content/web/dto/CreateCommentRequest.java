package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 发评论 / 回复。
 *
 * {@code replyToCommentId} 为空 = 一级评论；非空 = 回复那条评论。
 * 服务端会据此推出 {@code rootCommentId} 与 {@code replyToUserId} —— 客户端不传这三个。
 */
public record CreateCommentRequest(
        @Schema(type = "string", description = "回复的评论 id；为空表示发一级评论")
        Long replyToCommentId,

        @NotBlank(message = "评论内容不能为空")
        @Size(max = 2000, message = "评论不能超过 2000 字")
        String body
) {
}
