package top.katzenyasax.kuaikan.search.es;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 一条命中（原始形态，未做对外 DTO 的回落处理）。
 *
 * <h2>为什么保留 {@code sortValues}</h2>
 *
 * 它是下一页游标的唯一正确来源：{@code search_after} 要喂回的正是上一页最后一条
 * 命中的 {@code sort} 数组原件。自己用字段重新拼一遍（{@code score} 从哪来、
 * 浮点精度怎么截）只会引入一整类"翻页跳数据"的 bug，而 ES 已经把答案给出来了。
 *
 * <h2>为什么高亮与原文分开存</h2>
 *
 * 高亮可能为空（命中在别的字段上，或者片段恰好不含关键词）。"没高亮时回落到什么"
 * 是**产品决策**，属于 service 层；网关只如实上报 {@code null}，不替上层猜。
 *
 * @param createdAt      epoch 毫秒（mapping 里 {@code createdAt} 是 date）
 * @param titleHighlight 命中词被 {@code \uE000}/{@code \uE001} 包裹的标题；未命中为 null
 * @param bodySnippet    高亮器挑出的最佳正文片段；未命中为 null
 * @param sortValues     本条命中的 {@code sort} 数组，直接用于构造下一页游标
 */
public record PostSearchHit(
        String postId,
        String communityId,
        String communityName,
        String authorId,
        String authorNickname,
        String title,
        String body,
        String titleHighlight,
        String bodySnippet,
        long createdAt,
        JsonNode sortValues
) {
}
