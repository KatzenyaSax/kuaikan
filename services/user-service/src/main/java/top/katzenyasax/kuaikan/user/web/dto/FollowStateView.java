package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 我对某个目标用户的关注状态。前端据此渲染三态按钮：
 * {@code 关注} / {@code 已关注} / {@code 互相关注}（following && followedBy）。
 *
 * 单独成一个端点而不是塞进 profile：profile 是游客可读的，
 * 而「我关注了谁」只有登录后才有意义（p55-social.md §3.1）。
 */
public record FollowStateView(
        @Schema(description = "我是否关注 ta")
        boolean following,
        @Schema(description = "ta 是否关注我")
        boolean followedBy
) {
}
