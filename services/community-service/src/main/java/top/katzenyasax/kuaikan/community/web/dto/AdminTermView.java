package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 一位管理员的任期（历代管理员脉络的一项）。
 *
 * 任期**不是**一张表，而是从 t_community_history 的事件流推出来的：
 * COMMUNITY_CREATED 给出首任，每条 ADMIN_TRANSFERRED 给出下一任。
 * 存一张任期表就意味着两处状态永远可能对不上（事件流才是事实）。
 *
 * {@code endedAt} 为 null 且 {@code current=true} 表示现任——
 * 这两个字段必须同时判断：一个"没有结束时间但已经不是现任"的任期
 * 只会出现在事件流断裂的脏数据里，不该被前端悄悄当成现任。
 */
public record AdminTermView(
        @Schema(description = "第几任，从 1 开始")
        int term,
        @Schema(type = "string", description = "该任管理员用户 id")
        Long userId,
        LocalDateTime startedAt,
        @Schema(description = "卸任时间；现任为 null")
        LocalDateTime endedAt,
        @Schema(description = "是否为现任管理员")
        boolean current
) {
}
