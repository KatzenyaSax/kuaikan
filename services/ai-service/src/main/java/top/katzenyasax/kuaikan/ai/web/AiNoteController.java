package top.katzenyasax.kuaikan.ai.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.ai.service.AiNoteService;
import top.katzenyasax.kuaikan.ai.web.dto.NoteDetailView;
import top.katzenyasax.kuaikan.ai.web.dto.NoteSummaryView;
import top.katzenyasax.kuaikan.ai.web.dto.NoteUpsertRequest;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.UserContext;

/**
 * 个人 Markdown 私密笔记 CRUD（网关对外 /api/ai/notes）。
 */
@Tag(name = "AI 私密笔记")
@RestController
@RequestMapping("/notes")
public class AiNoteController {

    private final AiNoteService noteService;

    public AiNoteController(AiNoteService noteService) {
        this.noteService = noteService;
    }

    @Operation(operationId = "listAiNotes", summary = "分页查询我的私密笔记")
    @GetMapping
    public Result<PageResult<NoteSummaryView>> list(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(noteService.listNotes(requireUserId(), cursor, limit));
    }

    @Operation(operationId = "getAiNote", summary = "获取单篇私密笔记详情")
    @GetMapping("/{id}")
    public Result<NoteDetailView> get(@PathVariable("id") Long id) {
        return Result.ok(noteService.getNote(requireUserId(), id));
    }

    @Operation(operationId = "createAiNote", summary = "新建私密笔记")
    @PostMapping
    public Result<NoteDetailView> create(@RequestBody NoteUpsertRequest req) {
        return Result.ok(noteService.createNote(requireUserId(), req));
    }

    @Operation(operationId = "updateAiNote", summary = "更新私密笔记")
    @PutMapping("/{id}")
    public Result<NoteDetailView> update(@PathVariable("id") Long id,
                                         @RequestBody NoteUpsertRequest req) {
        return Result.ok(noteService.updateNote(requireUserId(), id, req));
    }

    @Operation(operationId = "deleteAiNote", summary = "硬删除私密笔记并同步清理向量")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable("id") Long id) {
        noteService.deleteNote(requireUserId(), id);
        return Result.ok();
    }

    private Long requireUserId() {
        Long userId = UserContext.userId();
        if (userId == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return userId;
    }
}
