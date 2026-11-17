package top.katzenyasax.kuaikan.content.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 内部接口的返回：目标存在吗、作者是谁、叫什么。
 *
 * {@code ownerId} 给 interaction 填事件载荷用。
 * {@code title} / {@code excerpt} 是 P4.2 追加的：notification 消费事件时要拼消息快照
 * "某某赞了你的《标题》"。追加字段符合不变量 13（只允许追加可选字段），
 * P3 的调用方（interaction）不读新字段，不受影响。
 *
 * 用 exists 布尔而不是抛异常表达"不存在"——内部**查询**接口回答"是什么"，
 * 不是"做什么"，所以它总是成功返回（同 P2.3 的 memberships）。
 */
public record TargetView(
        boolean exists,
        @Schema(type = "string") Long ownerId,
        @Schema(description = "帖子标题；目标为评论时是它所属帖子的标题")
        String title,
        @Schema(description = "正文摘录；目标为评论时是评论正文")
        String excerpt
) {
    public static TargetView missing() {
        return new TargetView(false, null, null, null);
    }

    public static TargetView of(Long ownerId, String title, String excerpt) {
        return new TargetView(true, ownerId, title, excerpt);
    }
}
