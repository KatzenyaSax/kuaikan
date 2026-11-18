package top.katzenyasax.kuaikan.rank.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/** interaction `POST /internal/counts/since` 的返回元素 */
public record SinceResponseView(
        @Schema(type = "string") String targetId,
        long likeDelta,
        long favoriteDelta
) {
}
