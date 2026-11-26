package top.katzenyasax.kuaikan.search.es;

/**
 * 笔记切片索引检索后按 {@code noteId} 归并的命中结果（P9.3）。
 */
public record NoteChunkSearchHit(
        String noteId,
        String title,
        String chunkText,
        long updatedAt,
        double score
) {
}
