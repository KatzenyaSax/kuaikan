package top.katzenyasax.kuaikan.search.web.dto;

/**
 * 全量重建的结果（P6.2）。
 *
 * @param indexName    新建并已挂上别名的物理索引名，形如 {@code post_v20261123153000}
 * @param indexedCount 写入的文档数（= content 里 {@code status=1} 的帖子数）
 * @param elapsedMs    从建索引到别名切换完成的总耗时
 */
public record RebuildResult(String indexName, long indexedCount, long elapsedMs) {
}
