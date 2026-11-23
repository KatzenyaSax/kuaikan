package top.katzenyasax.kuaikan.search.feign.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * user {@code POST /internal/users/batch} 的返回元素。
 *
 * 只有 id 与 nickname：索引里只需要这两个字段。
 * 返回数组里缺某个 id = 该账号已注销 / 不存在，调用方降级为「已注销用户」。
 */
public record InternalUserView(
        @Schema(type = "string") Long id,
        String nickname
) {
}
