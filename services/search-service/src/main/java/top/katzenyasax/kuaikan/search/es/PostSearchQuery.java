package top.katzenyasax.kuaikan.search.es;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * 一次帖子检索的完整入参（对外与对内两条接口共用同一套查询构造）。
 *
 * <h2>为什么 filters 是"裸 JSON 子句列表"而不是一堆具名参数</h2>
 *
 * 对外只会有 {@code communityId} 一条过滤，对内则有 authorId / communityId /
 * 昵称 / 社群名 / 时间范围任意组合。把字段一个个摊成 record 组件，会让
 * {@link ElasticsearchGateway} 的构造函数里出现一长串 {@code if (x != null)}，
 * 而实际差异只是"往 bool.filter 里塞什么"。由 service 层决定塞哪些子句，
 * 网关只负责拼装与解析，职责更清楚。
 *
 * <h2>limit 与 size 的关系</h2>
 *
 * 这里传的是**用户要的条数**，网关自己去多取一条判 {@code hasMore}。
 * 让调用方传 {@code limit + 1} 的话，"有没有下一页"这个判断就会散到两个类里。
 *
 * @param sort        排序方式
 * @param keyword     全文检索词；{@code null} 表示不加 multi_match（对内允许条件全空）
 * @param filters     {@code bool.filter} 子句列表，空列表表示不过滤
 * @param searchAfter 上一页最后一条命中的 {@code sort} 数组；空表示第一页
 * @param limit       返回条数（1 起）
 * @param highlight   是否要高亮（对外要，对内不要 —— AI 读的是原文）
 */
public record PostSearchQuery(
        SearchSort sort,
        String keyword,
        List<Map<String, Object>> filters,
        List<JsonNode> searchAfter,
        int limit,
        boolean highlight
) {

    public PostSearchQuery {
        if (sort == null) {
            throw new IllegalArgumentException("sort 不能为空");
        }
        if (limit < 1) {
            throw new IllegalArgumentException("limit 必须 >= 1，实际 " + limit);
        }
        filters = filters == null ? List.of() : List.copyOf(filters);
        searchAfter = searchAfter == null ? List.of() : List.copyOf(searchAfter);
    }
}
