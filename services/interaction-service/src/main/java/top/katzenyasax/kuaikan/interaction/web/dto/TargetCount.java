package top.katzenyasax.kuaikan.interaction.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** 某个目标的"事实计数"。对账用：content 拿它覆盖自己的派生计数 */
public record TargetCount(
        @Schema(description = "post 或 comment") String targetType,
        @Schema(type = "string") Long targetId,
        long likeCount,
        long favoriteCount
) {
}
