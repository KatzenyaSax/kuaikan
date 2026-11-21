package top.katzenyasax.kuaikan.interaction.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

/**
 * 「我的收藏」的一项：只要帖子 id 与收藏时间。
 *
 * <b>刻意只返回两列</b>：帖子标题 / 社群 / 作者由前端拿这批 postId 去
 * {@code POST /api/content/posts/batch} 补齐（ADR 0005：读路径由前端并发聚合）。
 * interaction-service 不跨库 JOIN 帖子，也不回查 content —— 那会把它变成读放大点。
 *
 * <b>postId 标注 type=string</b>：雪花 id 超出 JS 安全整数范围，全站 id 一律字符串下发。
 * 生成的前端类型因此是 string，直接当 Map 的 key 用不会丢精度。
 */
public record FavoriteItem(
        @Schema(type = "string", description = "帖子 id（雪花 id，字符串下发）")
        Long postId,

        @Schema(description = "收藏时间，列表按它倒序")
        LocalDateTime createdAt
) {
}
