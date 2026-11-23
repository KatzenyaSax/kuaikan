package top.katzenyasax.kuaikan.search.es;

import java.util.List;

/**
 * 一页检索结果。
 *
 * {@code hasMore} 由"多取一条"得出（请求 {@code limit + 1}，命中数超过 {@code limit}
 * 就有下一页），因此**不需要** {@code track_total_hits}：
 * 搜索结果的总数既不稳定（准实时索引）也没人展示，让它去数全量命中是纯浪费。
 *
 * @param hits    最多 {@code limit} 条（多取的那一条已被裁掉）
 * @param hasMore 是否还有下一页
 */
public record PostSearchPage(List<PostSearchHit> hits, boolean hasMore) {

    public PostSearchPage {
        hits = hits == null ? List.of() : List.copyOf(hits);
    }
}
