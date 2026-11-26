package top.katzenyasax.kuaikan.search.es;

/**
 * 切片索引检索后按文档 ID 归并的命中结果（P9.0）。
 */
public record ChunkSearchHit(
        String postId,
        String communityId,
        String communityName,
        String authorId,
        String authorNickname,
        String title,
        String chunkText,
        long createdAt,
        double score
) {
}
