package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 评论里一个解析成功的 @。
 *
 * 同时落库（`t_comment.mentions` 的 JSON 元素）和对外返回，
 * 形状必须一致——两侧共用一个 record，改字段时漏改一边会直接编译不过。
 *
 * {@code nickname} 是**写入时的快照**，不是当前昵称：正文里写的就是当时的名字，
 * 对方改名后 `@旧名` 仍应链到同一个人（不变量 9 的同一个道理）。
 */
public record MentionView(
        @Schema(type = "string", description = "被 @ 的用户 id")
        String userId,
        @Schema(description = "写入时的昵称快照，用于在正文里定位这段文字")
        String nickname
) {
}
