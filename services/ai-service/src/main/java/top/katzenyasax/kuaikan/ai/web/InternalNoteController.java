package top.katzenyasax.kuaikan.ai.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.ai.service.AiNoteService;
import top.katzenyasax.kuaikan.ai.web.dto.InternalNoteView;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;

/**
 * 内部读接口：供 {@code search-service} 消费 MQ 事件回查与全量重建 {@code note_chunk_v*}。
 */
@Hidden
@RestController
@RequestMapping("/internal/notes")
public class InternalNoteController {

    private final AiNoteService noteService;

    public InternalNoteController(AiNoteService noteService) {
        this.noteService = noteService;
    }

    @GetMapping("/{noteId}")
    public Result<InternalNoteView> getNote(@PathVariable("noteId") Long noteId) {
        return Result.ok(noteService.getInternalNote(noteId));
    }

    @GetMapping("/batch")
    public Result<PageResult<InternalNoteView>> batchNotes(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", defaultValue = "100") Integer limit) {
        return Result.ok(noteService.batchInternalNotes(cursor, limit));
    }
}
