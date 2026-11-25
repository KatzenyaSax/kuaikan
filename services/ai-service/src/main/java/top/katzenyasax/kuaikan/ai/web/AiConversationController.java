package top.katzenyasax.kuaikan.ai.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import top.katzenyasax.kuaikan.ai.service.AiChatService;
import top.katzenyasax.kuaikan.ai.web.dto.ConversationView;
import top.katzenyasax.kuaikan.ai.web.dto.SendMessageRequest;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.common.web.UserContext;

/**
 * AI 助手对话入口（网关 StripPrefix=2 后路径不带 /api/ai）。
 */
@Tag(name = "AI 助手")
@RestController
public class AiConversationController {

    private final AiChatService aiChatService;

    public AiConversationController(AiChatService aiChatService) {
        this.aiChatService = aiChatService;
    }

    @Operation(operationId = "createAiConversation", summary = "新建 AI 会话")
    @PostMapping("/conversations")
    public Result<ConversationView> createConversation() {
        return Result.ok(aiChatService.createConversation(requireUserId()));
    }

    @Operation(operationId = "streamAiMessage", summary = "向指定会话发送消息并流式返回 SSE")
    @PostMapping(
            value = "/conversations/{id}/messages",
            produces = {MediaType.TEXT_EVENT_STREAM_VALUE, MediaType.APPLICATION_JSON_VALUE})
    public SseEmitter streamMessage(@PathVariable("id") Long conversationId,
                                    @Valid @RequestBody SendMessageRequest req,
                                    @RequestHeader(value = Headers.AI_STUB, required = false) String stubScenario) {
        return aiChatService.streamMessage(requireUserId(), conversationId, req, stubScenario);
    }

    private Long requireUserId() {
        Long userId = UserContext.userId();
        if (userId == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return userId;
    }
}
