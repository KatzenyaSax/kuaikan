package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.NoteChanged;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.search.service.VectorIndexService;

/**
 * 个人私密笔记变更 → 回查 ai-service 后同步写入或清理 {@code note_chunk_write}（P9.3）。
 */
@Component
public class NoteVectorChangedConsumer extends AbstractSearchEventConsumer<NoteChanged> {

    private final VectorIndexService vectorIndexService;

    public NoteVectorChangedConsumer(
            VectorIndexService vectorIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.note-vector-changed-consumer-group}") String consumerGroup) {
        super("search-note-vector-changed", namesrvAddr, consumerGroup,
                Topics.NOTE_CHANGED, NoteChanged.class, json);
        this.vectorIndexService = vectorIndexService;
    }

    @Override
    protected void handle(NoteChanged event) {
        vectorIndexService.syncNoteChunks(event.noteId());
    }
}
