package top.katzenyasax.kuaikan.search.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

/**
 * 内部读取 {@code ai-service} 个人私密笔记（P9.3）。
 *
 * <p>消费 {@code kuaikan_note_changed} 与全量重建 {@code note_chunk_v*} 时回查 MySQL 真相。
 */
@FeignClient(name = Services.AI)
public interface AiNoteClient {

    @GetMapping("/internal/notes/{noteId}")
    Result<InternalNoteView> getNote(@PathVariable("noteId") String noteId);

    @GetMapping("/internal/notes/batch")
    Result<PageResult<InternalNoteView>> batchNotes(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", defaultValue = "100") int limit);

    record InternalNoteView(
            boolean exists,
            String noteId,
            String ownerId,
            String title,
            String content,
            boolean enabled,
            long updatedAt
    ) {
    }
}
