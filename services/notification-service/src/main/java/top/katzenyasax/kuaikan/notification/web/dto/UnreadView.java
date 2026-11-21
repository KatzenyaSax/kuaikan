package top.katzenyasax.kuaikan.notification.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 五类未读 + 总数。
 *
 * 一次查询 GROUP BY 拿到全部，不是五次 count。
 * 没有出现过的类型补 0，前端不用判 undefined。
 *
 * {@code total} 是五者之和，由后端算好——前端拼红点不该自己加，
 * 否则"@ 的分类改个名字"这类改动会在两处同时出错。
 *
 * P5.5.1 追加 {@code follow} 是**纯 append**：like / comment / mention / system 的位置与含义不变，
 * 老的调用方（只读四个字段）不需要改一行代码。
 */
public record UnreadView(
        long like,
        long comment,
        long mention,
        long system,
        @Schema(description = "P5.5.1 追加：关注未读数") long follow,
        long total
) {
}
