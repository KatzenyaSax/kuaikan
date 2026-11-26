package top.katzenyasax.kuaikan.search.es;

/**
 * 一篇私密笔记切片在 ES {@code note_chunk_v*} 里的文档形态（P9.3）。
 */
public record NoteChunkDocument(
        String chunkId,
        String noteId,
        String ownerId,
        int chunkIndex,
        String title,
        String chunkText,
        float[] embedding,
        long updatedAt
) {
}
