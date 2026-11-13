package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 内部接口的返回：目标存在吗、作者是谁。
 *
 * {@code ownerId} 给 interaction 填事件载荷用（P4 的"有人赞了你"需要它）。
 * 用 exists 布尔而不是抛异常表达"不存在"——内部**查询**接口回答"是什么"，
 * 不是"做什么"，所以它总是成功返回（同 P2.3 的 memberships）。
 */
public record TargetView(
        boolean exists,
        @Schema(type = "string") Long ownerId
) {
    public static TargetView missing() {
        return new TargetView(false, null);
    }

    public static TargetView of(Long ownerId) {
        return new TargetView(true, ownerId);
    }
}
