package top.katzenyasax.kuaikan.search.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.mq.PostCreated;
import top.katzenyasax.kuaikan.search.chunk.MarkdownChunker;
import top.katzenyasax.kuaikan.search.embedding.EmbeddingClient;
import top.katzenyasax.kuaikan.search.es.ElasticsearchGateway;
import top.katzenyasax.kuaikan.search.es.IndexNames;
import top.katzenyasax.kuaikan.search.es.NoteChunkDocument;
import top.katzenyasax.kuaikan.search.es.PostChunkDocument;
import top.katzenyasax.kuaikan.search.feign.AiNoteClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 向量切片索引的异步写路径（P9.1 / P9.3）。
 *
 * <p>与 P6 {@link PostIndexService} 物理隔离：TEI 推理超时只影响本消费组重投，
 * 绝不拖垮 P6 关键词搜索。
 */
@Service
public class VectorIndexService {

    private static final Logger log = LoggerFactory.getLogger(VectorIndexService.class);

    private final ElasticsearchGateway es;
    private final DirectoryService directory;
    private final PostIndexService postIndexService;
    private final MarkdownChunker chunker;
    private final EmbeddingClient embeddingClient;
    private final AiNoteClient aiNoteClient;

    public VectorIndexService(ElasticsearchGateway es,
                              DirectoryService directory,
                              PostIndexService postIndexService,
                              MarkdownChunker chunker,
                              EmbeddingClient embeddingClient,
                              AiNoteClient aiNoteClient) {
        this.es = es;
        this.directory = directory;
        this.postIndexService = postIndexService;
        this.chunker = chunker;
        this.embeddingClient = embeddingClient;
        this.aiNoteClient = aiNoteClient;
    }

    /** 帖子发布 → 切片 + 向量化 → 写入 {@code post_chunk_write} */
    public void indexPostChunks(PostCreated event) {
        postIndexService.ensurePostChunkReady();
        long authorId = parseId(event.authorId(), "authorId");
        long communityId = parseId(event.communityId(), "communityId");

        String nickname = directory.nickname(authorId);
        String communityName = directory.communityName(communityId);

        List<MarkdownChunker.Chunk> chunks = chunker.chunk(event.title(), event.body());
        List<String> texts = chunks.stream().map(MarkdownChunker.Chunk::text).toList();
        List<float[]> vectors = embeddingClient.embed(texts);

        List<PostChunkDocument> docs = new ArrayList<>(chunks.size());
        for (int i = 0; i < chunks.size(); i++) {
            MarkdownChunker.Chunk c = chunks.get(i);
            docs.add(new PostChunkDocument(
                    event.postId() + "_" + c.index(),
                    event.postId(),
                    event.communityId(),
                    event.authorId(),
                    c.index(),
                    event.title(),
                    c.text(),
                    nickname,
                    communityName,
                    vectors.get(i),
                    event.createdAt()));
        }

        es.deletePostChunks(event.postId());
        es.bulkIndexPostChunks(IndexNames.POST_CHUNK_WRITE, docs);
        log.debug("帖子向量切片已写入 postId={} chunks={}", event.postId(), docs.size());
    }

    /** 删帖 → 清理 {@code post_chunk_write} 全部切片 */
    public void deletePostChunks(String postId) {
        es.deletePostChunks(postId);
    }

    /** 笔记变更 → 回查 {@code ai-service} 最新状态，启用则全量重切写入，不存在或停用则删光 */
    public void syncNoteChunks(String noteId) {
        if (noteId == null || noteId.isBlank()) {
            return;
        }
        Result<AiNoteClient.InternalNoteView> res = aiNoteClient.getNote(noteId);
        AiNoteClient.InternalNoteView note = res == null ? null : res.data();
        if (note == null || !note.exists() || !note.enabled()) {
            es.deleteNoteChunks(noteId);
            log.debug("笔记向量切片已清理 noteId={}", noteId);
            return;
        }

        postIndexService.ensureNoteChunkReady();
        List<MarkdownChunker.Chunk> chunks = chunker.chunk(note.title(), note.content());
        List<String> texts = chunks.stream().map(MarkdownChunker.Chunk::text).toList();
        List<float[]> vectors = embeddingClient.embed(texts);

        List<NoteChunkDocument> docs = new ArrayList<>(chunks.size());
        for (int i = 0; i < chunks.size(); i++) {
            MarkdownChunker.Chunk c = chunks.get(i);
            docs.add(new NoteChunkDocument(
                    note.noteId() + "_" + c.index(),
                    note.noteId(),
                    note.ownerId(),
                    c.index(),
                    note.title(),
                    c.text(),
                    vectors.get(i),
                    note.updatedAt()));
        }
        es.deleteNoteChunks(note.noteId());
        es.bulkIndexNoteChunks(IndexNames.NOTE_CHUNK_WRITE, docs);
        log.debug("笔记向量切片已同步 noteId={} ownerId={} chunks={}",
                note.noteId(), note.ownerId(), docs.size());
    }

    private static long parseId(String raw, String field) {
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("事件载荷里的 " + field + " 不是合法雪花 id：" + raw, e);
        }
    }
}
