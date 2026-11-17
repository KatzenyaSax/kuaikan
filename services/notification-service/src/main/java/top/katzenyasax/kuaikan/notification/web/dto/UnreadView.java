package top.katzenyasax.kuaikan.notification.web.dto;

/**
 * 四类未读 + 总数。
 *
 * 一次查询 GROUP BY 拿到全部，不是四次 count。
 * 没有出现过的类型补 0，前端不用判 undefined。
 *
 * {@code total} 是四者之和，由后端算好——前端拼红点不该自己加，
 * 否则"@ 的分类改个名字"这类改动会在两处同时出错。
 */
public record UnreadView(
        long like,
        long comment,
        long mention,
        long system,
        long total
) {
}
