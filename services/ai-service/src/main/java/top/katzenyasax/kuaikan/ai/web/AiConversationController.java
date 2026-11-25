package top.katzenyasax.kuaikan.ai.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import top.katzenyasax.kuaikan.ai.service.AiChatService;
import top.katzenyasax.kuaikan.ai.service.AiComposeService;
import top.katzenyasax.kuaikan.ai.service.AiQuotaService;
import top.katzenyasax.kuaikan.ai.web.dto.ActionResultRequest;
import top.katzenyasax.kuaikan.ai.web.dto.ComposeRequest;
import top.katzenyasax.kuaikan.ai.web.dto.ConversationView;
import top.katzenyasax.kuaikan.ai.web.dto.MessageView;
import top.katzenyasax.kuaikan.ai.web.dto.QuotaView;
import top.katzenyasax.kuaikan.ai.web.dto.SendMessageRequest;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.common.web.UserContext;

/**
 * AI 助手全部对外入口（网关 StripPrefix=2 后路径不带 /api/ai）。
 */
@Tag(name = "AI 助手")
@RestController
public class AiConversationController {

    private final AiChatService aiChatService;
    private final AiComposeService aiComposeService;
    private final AiQuotaService aiQuotaService;

    public AiConversationController(AiChatService aiChatService,
                                    AiComposeService aiComposeService,
                                    AiQuotaService aiQuotaService) {
        this.aiChatService = aiChatService;
        this.aiComposeService = aiComposeService;
        this.aiQuotaService = aiQuotaService;
    }

    @Operation(operationId = "createAiConversation", summary = "新建 AI 会话")
    @PostMapping("/conversations")
    public Result<ConversationView> createConversation() {
        return Result.ok(aiChatService.createConversation(requireUserId()));
    }

    @Operation(operationId = "listAiConversations", summary = "查询我的 AI 会话列表（游标分页）")
    @GetMapping("/conversations")
    public Result<PageResult<ConversationView>> listConversations(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(aiChatService.listConversations(requireUserId(), cursor, limit));
    }

    @Operation(operationId = "listAiMessages", summary = "查询指定会话的消息历史")
    @GetMapping("/conversations/{id}/messages")
    public Result<PageResult<MessageView>> listMessages(
            @PathVariable("id") Long conversationId,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(aiChatService.listMessages(requireUserId(), conversationId, cursor, limit));
    }

    @Operation(operationId = "deleteAiConversation", summary = "删除指定 AI 会话")
    @DeleteMapping("/conversations/{id}")
    public Result<Void> deleteConversation(@PathVariable("id") Long conversationId) {
        aiChatService.deleteConversation(requireUserId(), conversationId);
        return Result.ok();
    }

    @Operation(operationId = "getAiQuota", summary = "查询今日 AI 对话剩余次数")
    @GetMapping("/quota")
    public Result<QuotaView> getQuota() {
        return Result.ok(aiQuotaService.getQuota(requireUserId()));
    }

    @Operation(operationId = "streamAiMessage", summary = "向指定会话发送消息并流式返回 SSE")
    @PostMapping(
            value = "/conversations/{id}/messages",
            produces = {MediaType.TEXT_EVENT_STREAM_VALUE, MediaType.APPLICATION_JSON_VALUE})
    public SseEmitter streamMessage(
            @PathVariable("id") Long conversationId,
            @Valid @RequestBody SendMessageRequest req,
            @RequestHeader(value = Headers.AI_STUB, required = false) String stubScenario) {
        return aiChatService.streamMessage(requireUserId(), conversationId, req, stubScenario);
    }

    @Operation(operationId = "streamAiCompose", summary = "编辑器内联 AI 帮写（SSE 流式）")
    @PostMapping(
            value = "/compose",
            produces = {MediaType.TEXT_EVENT_STREAM_VALUE, MediaType.APPLICATION_JSON_VALUE})
    public SseEmitter streamCompose(
            @Valid @RequestBody ComposeRequest req,
            @RequestHeader(value = Headers.AI_STUB, required = false) String stubScenario) {
        return aiComposeService.streamCompose(requireUserId(), req, stubScenario);
    }

    @Operation(operationId = "reportAiActionResult", summary = "回传确认卡执行结果并由 AI 续写（SSE）")
    @PostMapping(
            value = "/actions/{id}/result",
            produces = {MediaType.TEXT_EVENT_STREAM_VALUE, MediaType.APPLICATION_JSON_VALUE})
    public SseEmitter reportActionResult(
            @PathVariable("id") Long actionId,
            @Valid @RequestBody ActionResultRequest req,
            @RequestHeader(value = Headers.AI_STUB, required = false) String stubScenario) {
        return aiChatService.reportActionResult(requireUserId(), actionId, req, stubScenario);
    }

    private Long requireUserId() {
        Long userId = UserContext.userId();
        if (userId == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return userId;
    }
}
