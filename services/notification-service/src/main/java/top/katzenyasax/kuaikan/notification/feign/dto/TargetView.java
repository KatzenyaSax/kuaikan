package top.katzenyasax.kuaikan.notification.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * content-service 内部接口 GET /internal/targets 的返回体。
 *
 * 只需要 ownerId 之外的"显示用什么"：标题与摘录。它们进消息快照。
 */
public record TargetView(
        boolean exists,
        @Schema(type = "string") Long ownerId,
        String title,
        String excerpt,
        @Schema(type = "string", description = "落点帖子 id；目标为评论时是它所属帖子") Long postId,
        @Schema(type = "string", description = "社群 id，名字另行解析") Long communityId
) {
}
