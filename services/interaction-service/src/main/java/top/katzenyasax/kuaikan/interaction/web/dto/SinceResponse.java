package top.katzenyasax.kuaikan.interaction.web.dto;

/**
 * 窗口内增量。
 *
 * `likeDelta` / `favoriteDelta` **分开放而不是合并成一个数**：
 * 它们在热度公式里权重不同（收藏 4、点赞 2），合并了就丢了这个信息。
 *
 * 没出现在请求里的目标，或者窗口内零互动的目标，不会出现在返回里——
 * 调用方补 0。空数组不是错误。
 */
public record SinceResponse(
        String targetId,
        long likeDelta,
        long favoriteDelta
) {
}
