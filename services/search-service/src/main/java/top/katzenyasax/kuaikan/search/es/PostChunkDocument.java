package top.katzenyasax.kuaikan.search.es;

/**
 * 一篇帖子切片在 ES {@code post_chunk_v*} 里的文档形态（P9.0）。
 */
public record PostChunkDocument(
        String chunkId,
        String postId,
        String communityId,
        String authorId,
        int chunkIndex,
        String title,
        String chunkText,
        String authorNickname,
        String communityName,
        float[] embedding,
        long createdAt
) {
}
