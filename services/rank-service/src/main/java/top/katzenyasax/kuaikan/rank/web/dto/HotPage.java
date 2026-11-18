package top.katzenyasax.kuaikan.rank.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 热榜。**不分页**——Top 50 一次给完（architecture §7 已定）。
 *
 * {@code total} 是本次上榜条数，不是"有多少帖子参与过"。前端用它判断要不要显示空态。
 */
public record HotPage(
        @Schema(description = "day 或 week") String range,
        List<HotItem> items,
        int total
) {
}
