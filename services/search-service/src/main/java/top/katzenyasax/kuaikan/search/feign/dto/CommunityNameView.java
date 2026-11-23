package top.katzenyasax.kuaikan.search.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * community {@code POST /internal/communities/batch} 的返回元素。
 *
 * 返回数组里缺某个 id = 社群被删 / 不存在，调用方降级为空字符串。
 */
public record CommunityNameView(
        @Schema(type = "string") Long id,
        String name
) {
}
