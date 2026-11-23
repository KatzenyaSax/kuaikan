package top.katzenyasax.kuaikan.search.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 对内检索的入参（p6-search.md §5.2）。给未来的 AI 助手 / 运维工具用。
 *
 * <h2>允许全部为空</h2>
 *
 * 这不是"参数校验漏了"，而是核心用法：AI 助手总结"近期全站动态"时，
 * 一个关键词都给不出来，只想按 {@code latest} 顺序拉最近 N 条。
 * 所以空条件 = 按 {@code latest} 游标遍历全站，不是 40010。
 *
 * <h2>时间用 String 而不是 long / Instant</h2>
 *
 * 调用方是人（curl）也可能是脚本，两种写法都自然：epoch 毫秒
 * （{@code 1767225600000}）与 ISO-8601（{@code 2026-01-01T00:00:00Z}）。
 * 声明成 {@code long} 就把 ISO 写法排除掉了；声明成 {@code Instant} 则在
 * "传了个不带时区的日期"时抛 Jackson 的裸异常。收成 String、由 service 层
 * 显式解析，非法输入就是干净的 40010。
 *
 * <h2>ID 是 String</h2>
 *
 * 雪花 id 用字符串表达（与对外接口、事件载荷一致），避免 JSON 数字精度陷阱，
 * 也避免 term 查询出现数值/文本类型不匹配。
 *
 * @param keyword     全文检索词；为空则不加 multi_match
 * @param authorId    精确匹配 {@code authorId}（term）
 * @param authorNickname 作者昵称，精确或分词匹配（{@code .keyword} term + match）
 * @param communityId 精确匹配 {@code communityId}（term）
 * @param communityName 社群名，精确或分词匹配（{@code .keyword} term + match）
 * @param createdFrom 发布时间下界，epoch 毫秒或 ISO-8601
 * @param createdTo   发布时间上界，epoch 毫秒或 ISO-8601
 * @param sort        {@code relevance} | {@code latest}；无 keyword 时默认 {@code latest}
 * @param includeBody true 时返回完整正文（AI 阅读总结用）；默认 false 只给 excerpt
 */
public record InternalSearchPostsRequest(
        @Schema(description = "全文检索关键词（最长 100 字）；为空表示不做全文匹配")
        String keyword,
        @Schema(type = "string", description = "作者 id（雪花 id，字符串化），term 精确过滤")
        String authorId,
        @Schema(description = "作者昵称，精确或分词匹配")
        String authorNickname,
        @Schema(type = "string", description = "社群 id（雪花 id，字符串化），term 精确过滤")
        String communityId,
        @Schema(description = "社群名，精确或分词匹配")
        String communityName,
        @Schema(description = "发布时间下界：epoch 毫秒或 ISO-8601（如 2026-01-01T00:00:00Z）")
        String createdFrom,
        @Schema(description = "发布时间上界：epoch 毫秒或 ISO-8601（如 2026-02-01T00:00:00Z）")
        String createdTo,
        @Schema(description = "relevance | latest；无 keyword 时默认 latest")
        String sort,
        @Schema(description = "上一页返回的 nextCursor；为空表示第一页")
        String cursor,
        @Schema(description = "每页条数，默认 20，最大 100")
        Integer limit,
        @Schema(description = "是否返回完整正文，默认 false")
        Boolean includeBody
) {
}
