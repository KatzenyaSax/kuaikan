package top.katzenyasax.kuaikan.ai.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.ai.domain.AiConversation;
import top.katzenyasax.kuaikan.ai.domain.AiMessage;
import top.katzenyasax.kuaikan.ai.llm.LlmChatRequest;
import top.katzenyasax.kuaikan.ai.llm.LlmMessage;
import top.katzenyasax.kuaikan.ai.llm.LlmRouter;
import top.katzenyasax.kuaikan.ai.mapper.AiConversationMapper;
import top.katzenyasax.kuaikan.ai.mapper.AiMessageMapper;
import top.katzenyasax.kuaikan.ai.web.dto.ConversationView;
import top.katzenyasax.kuaikan.ai.web.dto.PageContextDto;
import top.katzenyasax.kuaikan.ai.web.dto.SendMessageRequest;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * P8.0 流式对话骨架服务：会话建立、归属校验、SSE 全链路穿透与消息持久化。
 */
@Service
public class AiChatService {

    private static final Logger log = LoggerFactory.getLogger(AiChatService.class);
    private static final String DEFAULT_TITLE = "新对话";
    private static final long HEARTBEAT_SECONDS = 15L;

    private final AiConversationMapper conversationMapper;
    private final AiMessageMapper messageMapper;
    private final LlmRouter llmRouter;
    private final AiProperties props;
    private final ObjectMapper objectMapper;

    public AiChatService(AiConversationMapper conversationMapper,
                         AiMessageMapper messageMapper,
                         LlmRouter llmRouter,
                         AiProperties props,
                         ObjectMapper objectMapper) {
        this.conversationMapper = conversationMapper;
        this.messageMapper = messageMapper;
        this.llmRouter = llmRouter;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    public ConversationView createConversation(Long userId) {
        AiConversation conv = new AiConversation();
        conv.setUserId(userId);
        conv.setTitle(DEFAULT_TITLE);
        conv.setStatus(AiConversation.STATUS_ACTIVE);
        conversationMapper.insert(conv);
        return ConversationView.of(conv);
    }

    public SseEmitter streamMessage(Long userId, Long conversationId,
                                    SendMessageRequest req, String stubScenario) {
        AiConversation conv = conversationMapper.selectOne(new LambdaQueryWrapper<AiConversation>()
                .eq(AiConversation::getId, conversationId)
                .eq(AiConversation::getUserId, userId)
                .eq(AiConversation::getStatus, AiConversation.STATUS_ACTIVE));
        if (conv == null) {
            throw new BizException(AiErrorCode.AI_CONVERSATION_NOT_FOUND);
        }

        String pageContextJson = serializePageContext(req.pageContext());
        AiMessage userMsg = new AiMessage();
        userMsg.setConversationId(conversationId);
        userMsg.setUserId(userId);
        userMsg.setRole(AiMessage.ROLE_USER);
        userMsg.setContent(req.content().trim());
        userMsg.setPageContext(pageContextJson);
        userMsg.setPromptTokens(0);
        userMsg.setCompletionTokens(0);
        messageMapper.insert(userMsg);

        if (DEFAULT_TITLE.equals(conv.getTitle())) {
            conv.setTitle(deriveTitle(req.content()));
            conversationMapper.updateById(conv);
        }

        Long assistantMsgId = IdWorker.getId();
        SseEmitter emitter = new SseEmitter(props.getTurnTimeoutMs() + 10_000L);

        AtomicBoolean closed = new AtomicBoolean(false);
        Object sendLock = new Object();
        AtomicReference<Disposable> llmSubRef = new AtomicReference<>();
        AtomicReference<Disposable> hbSubRef = new AtomicReference<>();

        Runnable cleanup = () -> {
            if (closed.compareAndSet(false, true)) {
                Disposable hb = hbSubRef.getAndSet(null);
                if (hb != null) {
                    hb.dispose();
                }
                Disposable sub = llmSubRef.getAndSet(null);
                if (sub != null) {
                    sub.dispose();
                }
            }
        };

        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            safeComplete(emitter);
        });
        emitter.onError(e -> cleanup.run());

        // 先推送 meta 事件，让浏览器与反代立刻看到首帧字节
        sendEvent(emitter, sendLock, closed, cleanup, "meta", Map.of(
                "conversationId", String.valueOf(conversationId),
                "messageId", String.valueOf(assistantMsgId),
                "quotaRemaining", 50
        ));

        Disposable hb = Flux.interval(Duration.ofSeconds(HEARTBEAT_SECONDS))
                .subscribe(tick -> sendComment(emitter, sendLock, closed, cleanup, "ping"));
        hbSubRef.set(hb);

        LlmChatRequest llmReq = buildRequest(req);
        StringBuilder fullText = new StringBuilder();
        AtomicInteger promptTokens = new AtomicInteger(0);
        AtomicInteger completionTokens = new AtomicInteger(0);

        Disposable sub = llmRouter.streamChat(llmReq, stubScenario)
                .timeout(Duration.ofMillis(props.getTurnTimeoutMs()))
                .subscribe(
                        chunk -> {
                            if (closed.get()) {
                                return;
                            }
                            if (chunk.promptTokens() != null) {
                                promptTokens.set(chunk.promptTokens());
                            }
                            if (chunk.completionTokens() != null) {
                                completionTokens.set(chunk.completionTokens());
                            }
                            if (chunk.contentDelta() != null && !chunk.contentDelta().isEmpty()) {
                                fullText.append(chunk.contentDelta());
                                sendEvent(emitter, sendLock, closed, cleanup,
                                        "delta", Map.of("text", chunk.contentDelta()));
                            }
                        },
                        err -> {
                            int code = AiErrorCode.AI_UNAVAILABLE.code();
                            String message = AiErrorCode.AI_UNAVAILABLE.message();
                            if (err instanceof BizException be) {
                                code = be.code();
                                message = be.getMessage();
                            }
                            log.warn("AI 流式对话失败 convId={} userId={} code={}", conversationId, userId, code);
                            sendEvent(emitter, sendLock, closed, cleanup, "error", Map.of(
                                    "code", code,
                                    "message", message
                            ));
                            cleanup.run();
                            safeComplete(emitter);
                        },
                        () -> {
                            if (closed.get()) {
                                return;
                            }
                            sendEvent(emitter, sendLock, closed, cleanup, "citations", List.of());

                            int pTok = promptTokens.get();
                            int cTok = completionTokens.get();
                            persistAssistantMessage(assistantMsgId, conversationId, userId,
                                    fullText.toString(), pTok, cTok, conv);

                            sendEvent(emitter, sendLock, closed, cleanup, "done", Map.of(
                                    "usage", Map.of(
                                            "promptTokens", pTok,
                                            "completionTokens", cTok
                                    )
                            ));
                            cleanup.run();
                            safeComplete(emitter);
                        }
                );
        llmSubRef.set(sub);
        if (closed.get()) {
            sub.dispose();
        }
        return emitter;
    }

    private void persistAssistantMessage(Long assistantMsgId, Long conversationId, Long userId,
                                         String content, int promptTokens, int completionTokens,
                                         AiConversation conv) {
        AiMessage msg = new AiMessage();
        msg.setId(assistantMsgId);
        msg.setConversationId(conversationId);
        msg.setUserId(userId);
        msg.setRole(AiMessage.ROLE_ASSISTANT);
        msg.setContent(content);
        msg.setCitations("[]");
        msg.setPromptTokens(promptTokens);
        msg.setCompletionTokens(completionTokens);
        msg.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
        messageMapper.insert(msg);
        conversationMapper.updateById(conv);
    }

    private LlmChatRequest buildRequest(SendMessageRequest req) {
        List<LlmMessage> messages = new ArrayList<>(3);
        messages.add(LlmMessage.system("你是 kuaikan 社区的 AI 助手。请友好、简明地使用中文回答用户问题。"));
        if (req.pageContext() != null && req.pageContext().type() != null) {
            PageContextDto ctx = req.pageContext();
            StringBuilder hint = new StringBuilder("当前页面上下文标识：type=").append(ctx.type());
            if (ctx.postId() != null) {
                hint.append(", postId=").append(ctx.postId());
            }
            if (ctx.communityName() != null) {
                hint.append(", communityName=").append(ctx.communityName());
            }
            if (ctx.userId() != null) {
                hint.append(", userId=").append(ctx.userId());
            }
            messages.add(LlmMessage.system(hint.toString()));
        }
        messages.add(LlmMessage.user(req.content().trim()));
        return new LlmChatRequest(messages, props.getMaxTokens());
    }

    private String deriveTitle(String content) {
        String s = content.trim().replaceAll("\\s+", " ");
        if (s.length() <= 24) {
            return s;
        }
        return s.substring(0, 24) + "…";
    }

    private String serializePageContext(PageContextDto ctx) {
        if (ctx == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(ctx);
        } catch (Exception e) {
            return null;
        }
    }

    private void sendEvent(SseEmitter emitter, Object sendLock, AtomicBoolean closed,
                           Runnable cleanup, String eventName, Object data) {
        synchronized (sendLock) {
            if (closed.get()) {
                return;
            }
            try {
                emitter.send(SseEmitter.event().name(eventName).data(data));
            } catch (Exception e) {
                log.debug("SSE 写事件失败（客户端可能已断开）event={} err={}", eventName, e.toString());
                cleanup.run();
            }
        }
    }

    private void sendComment(SseEmitter emitter, Object sendLock, AtomicBoolean closed,
                             Runnable cleanup, String comment) {
        synchronized (sendLock) {
            if (closed.get()) {
                return;
            }
            try {
                emitter.send(SseEmitter.event().comment(comment));
            } catch (Exception e) {
                cleanup.run();
            }
        }
    }

    private void safeComplete(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (Exception ignored) {
            // 对端已关闭时忽略
        }
    }
}
