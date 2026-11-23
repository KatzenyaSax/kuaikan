package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.content.domain.Post;

import java.time.ZoneId;

/**
 * 内部全量拉帖的一项（P6.1）。给 search-service 重建索引用。
 *
 * <b>含完整 {@code body}</b>：重建时索引要的是全文，不是摘要。
 * 这条接口只在容器网络内可见（网关不路由 {@code /internal/**}）。
 *
 * <b>{@code createdAt} 用 epoch 毫秒</b>：与 {@code PostCreated} 事件载荷同一种表示，
 * 消费方不需要为「事件里的时间」和「回填时的时间」写两套解析。
 *
 * <b>没有 authorNickname / communityName</b>：这两个是反范式冗余，
 * 由调用方拿 {@code authorId} / {@code communityId} 走 user/community 的批量接口补齐，
 * 与事件路径保持一致（content 不是它们的所有者）。
 */
public record InternalSearchPostItem(
        @Schema(type = "string", description = "帖子 id（雪花 id，字符串化）")
        Long postId,
        @Schema(type = "string", description = "社群 id（雪花 id，字符串化）")
        Long communityId,
        @Schema(type = "string", description = "作者 id（雪花 id，字符串化）")
        Long authorId,
        String title,
        String body,
        @Schema(description = "发布时间，epoch 毫秒")
        long createdAt
) {
    public static InternalSearchPostItem of(Post post) {
        return new InternalSearchPostItem(
                post.getId(),
                post.getCommunityId(),
                post.getAuthorId(),
                post.getTitle(),
                post.getBody(),
                post.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli());
    }
}
