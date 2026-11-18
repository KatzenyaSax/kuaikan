package top.katzenyasax.kuaikan.rank.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 榜上一条。
 *
 * {@code score} 是**要展示给用户的热度值**——不给的话"为什么它排第一"
 * 就没法解释。四舍五入到一位小数，15 位有效数字只会有噪音。
 */
public record HotItem(
        int rank,
        @Schema(type = "string", description = "帖子 id") String postId,
        String title,
        @Schema(description = "社群名快照；为 null 表示社群已被删") String communityName,
        @Schema(type = "string", description = "作者 id，昵称由前端批量获取") String authorId,
        double score
) {
}
