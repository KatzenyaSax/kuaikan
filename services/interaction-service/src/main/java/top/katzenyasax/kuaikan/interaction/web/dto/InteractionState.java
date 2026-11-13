package top.katzenyasax.kuaikan.interaction.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 某个目标对"我"的互动状态。一屏几十个目标也只是一个数组。
 *
 * 刻意不用事件结构（InteractionChange）来表达状态：事件是过去的事实，
 * 状态是此刻的情况，两者字段语义不同，混用会让调用方误读。
 */
public record InteractionState(
        @Schema(description = "post 或 comment") String targetType,
        @Schema(type = "string") Long targetId,
        boolean liked,
        boolean favorited
) {
}
