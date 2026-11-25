package top.katzenyasax.kuaikan.ai.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.ai.feign.CommunityClient;
import top.katzenyasax.kuaikan.ai.feign.ContentClient;
import top.katzenyasax.kuaikan.ai.llm.LlmChatRequest;
import top.katzenyasax.kuaikan.ai.llm.LlmMessage;
import top.katzenyasax.kuaikan.ai.llm.LlmRouter;
import top.katzenyasax.kuaikan.ai.web.dto.ComposeRequest;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 编辑器内联帮写（P8.2）：无会话持久化，扣减用户日配额，直接流式产出草稿建议。
 */
@Service
public class AiComposeService {

    private static final Logger log = LoggerFactory.getLogger(AiComposeService.class);
    private static final long HEARTBEAT_SECONDS = 15L;

    private final AiQuotaService quotaService;
    private final LlmRouter llmRouter;
    private final ContentClient contentClient;
    private final CommunityClient communityClient;
    private final AiProperties props;

    public AiComposeService(AiQuotaService quotaService,
                            LlmRouter llmRouter,
                            ContentClient contentClient,
                            CommunityClient communityClient,
                            AiProperties props) {
        this.quotaService = quotaService;
        this.llmRouter = llmRouter;
        this.contentClient = contentClient;
        this.communityClient = communityClient;
        this.props = props;
    }

    public SseEmitter streamCompose(Long userId, ComposeRequest req, String stubScenario) {
        String lockToken = quotaService.acquireStreamLock(userId);
        int quotaRemaining;
        try {
            quotaService.assertWithinBudget();
            quotaRemaining = quotaService.consumeQuota(userId);
        } catch (RuntimeException e) {
            quotaService.releaseStreamLock(userId, lockToken);
            throw e;
        }

        SseEmitter emitter = new SseEmitter(props.getTurnTimeoutMs() + 10_000L);
        AtomicBoolean closed = new AtomicBoolean(false);
        Object sendLock = new Object();
        AtomicReference<Disposable> llmSubRef = new AtomicReference<>();
        AtomicReference<Disposable> hbSubRef = new AtomicReference<>();

        Runnable cleanup = () -> {
            if (closed.compareAndSet(false, true)) {
                Disposable hb = hbSubRef.getAndSet(null);
                if (hb != null) hb.dispose();
                Disposable sub = llmSubRef.getAndSet(null);
                if (sub != null) sub.dispose();
                quotaService.releaseStreamLock(userId, lockToken);
            }
        };

        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            safeComplete(emitter);
        });
        emitter.onError(e -> cleanup.run());

        sendEvent(emitter, sendLock, closed, cleanup, "meta", Map.of(
                "quotaRemaining", quotaRemaining
        ));

        Disposable hb = Flux.interval(Duration.ofSeconds(HEARTBEAT_SECONDS))
                .subscribe(tick -> sendComment(emitter, sendLock, closed, cleanup, "ping"));
        hbSubRef.set(hb);

        LlmChatRequest llmReq = buildComposeRequest(req);
        AtomicInteger pTok = new AtomicInteger(0);
        AtomicInteger cTok = new AtomicInteger(0);

        Disposable sub = llmRouter.streamChat(llmReq, stubScenario)
                .timeout(Duration.ofMillis(props.getTurnTimeoutMs()))
                .subscribe(
                        chunk -> {
                            if (closed.get()) return;
                            if (chunk.promptTokens() != null) pTok.set(chunk.promptTokens());
                            if (chunk.completionTokens() != null) cTok.set(chunk.completionTokens());
                            if (chunk.contentDelta() != null && !chunk.contentDelta().isEmpty()) {
                                sendEvent(emitter, sendLock, closed, cleanup, "delta",
                                        Map.of("text", chunk.contentDelta()));
                            }
                        },
                        err -> {
                            int code = AiErrorCode.AI_UNAVAILABLE.code();
                            String message = AiErrorCode.AI_UNAVAILABLE.message();
                            if (err instanceof BizException be) {
                                code = be.code();
                                message = be.getMessage();
                            }
                            log.warn("AI 帮写流式失败 userId={} code={}", userId, code);
                            sendEvent(emitter, sendLock, closed, cleanup, "error", Map.of(
                                    "code", code,
                                    "message", message
                            ));
                            cleanup.run();
                            safeComplete(emitter);
                        },
                        () -> {
                            if (closed.get()) return;
                            quotaService.addBudgetTokens((long) pTok.get() + cTok.get());
                            sendEvent(emitter, sendLock, closed, cleanup, "done", Map.of(
                                    "usage", Map.of("promptTokens", pTok.get(), "completionTokens", cTok.get())
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

    private LlmChatRequest buildComposeRequest(ComposeRequest req) {
        String draft = req.draft() == null ? "" : req.draft().trim();
        List<LlmMessage> messages = new ArrayList<>(3);
        String instruction = switch (req.mode()) {
            case "EXPAND" -> "你是社区写作助手。请基于用户提供的标题或草稿，扩写为结构清晰、有具体细节的中文 Markdown 正文，只输出可直接填入编辑器的正文内容，不要输出多余客套话。";
            case "POLISH" -> "你是社区写作助手。请润色用户提供的草稿，保持原意、提升表达流畅度与条理性，只输出润色后的内容，不要输出解释。";
            case "SHORTEN" -> "你是社区写作助手。请精简提炼用户提供的草稿，保留核心观点，只输出精简后的内容。";
            case "RECOMMEND_COMMUNITY" -> "你是社区导航助手。根据用户的草稿主题，从提供的站内社群列表里推荐 1~3 个最匹配的社群并简述理由。";
            case "REPLY" -> "你是社区讨论助手。结合提供的原帖内容与用户的思路草稿，起草一条友好、切题的中文评论/回复，只输出回复正文。";
            default -> "请协助优化文本。";
        };
        messages.add(LlmMessage.system(instruction));

        if ("RECOMMEND_COMMUNITY".equals(req.mode())) {
            try {
                Result<CommunityClient.CommunityPageRow> res = communityClient.listCommunities(30);
                if (res != null && res.getData() != null && res.getData().items() != null) {
                    StringBuilder sb = new StringBuilder("站内现有社群：\n");
                    for (CommunityClient.CommunitySummaryRow c : res.getData().items()) {
                        sb.append("- ").append(c.name()).append("：")
                                .append(c.description() == null ? "" : c.description()).append("\n");
                    }
                    messages.add(LlmMessage.system(sb.toString()));
                }
            } catch (Exception ignored) {
                // 降级
            }
        }

        if ("REPLY".equals(req.mode()) && req.postId() != null && !req.postId().isBlank()) {
            try {
                Long pid = Long.valueOf(req.postId().trim());
                Result<ContentClient.PostRow> res = contentClient.getPost(pid);
                if (res != null && res.getData() != null) {
                    ContentClient.PostRow p = res.getData();
                    String body = p.body() == null ? "" : (p.body().length() > 1500 ? p.body().substring(0, 1500) : p.body());
                    messages.add(LlmMessage.system("原帖标题：《" + p.title() + "》\n原帖正文：\n" + body));
                }
            } catch (Exception ignored) {
                // 降级
            }
        }

        messages.add(LlmMessage.user(draft.isEmpty() ? "请帮我起草一段内容。" : draft));
        return new LlmChatRequest(messages, props.getMaxTokens());
    }

    private void sendEvent(SseEmitter emitter, Object sendLock, AtomicBoolean closed,
                           Runnable cleanup, String eventName, Object data) {
        synchronized (sendLock) {
            if (closed.get()) return;
            try {
                emitter.send(SseEmitter.event().name(eventName).data(data));
            } catch (Exception e) {
                cleanup.run();
            }
        }
    }

    private void sendComment(SseEmitter emitter, Object sendLock, AtomicBoolean closed,
                             Runnable cleanup, String comment) {
        synchronized (sendLock) {
            if (closed.get()) return;
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
            // ignore
        }
    }
}
