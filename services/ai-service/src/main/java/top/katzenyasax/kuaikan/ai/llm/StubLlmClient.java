package top.katzenyasax.kuaikan.ai.llm;

import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.util.List;

/**
 * 确定性测试 Stub 实现，仅在 stub-enabled=true 且内网直连带 X-AI-Stub 时由 LlmRouter 选中。
 */
@Component
public class StubLlmClient implements LlmClient {

    @Override
    public Flux<LlmStreamChunk> streamChat(LlmChatRequest request, String stubScenario) {
        if ("error".equalsIgnoreCase(stubScenario)) {
            return Flux.error(new BizException(AiErrorCode.AI_UNAVAILABLE));
        }

        String userPrompt = request.messages().stream()
                .filter(m -> "user".equals(m.role()))
                .reduce((a, b) -> b)
                .map(LlmMessage::content)
                .orElse("");

        String reply = "[stub:" + stubScenario + "] 收到消息：" + userPrompt;
        List<String> parts = splitChunks(reply, 6);

        Flux<LlmStreamChunk> textFlux = Flux.fromIterable(parts)
                .delayElements(Duration.ofMillis(30))
                .map(p -> new LlmStreamChunk(p, List.of(), null, null, null));

        LlmStreamChunk tail = new LlmStreamChunk(null, List.of(), "stop", 12, Math.max(1, reply.length()));
        return textFlux.concatWithValues(tail);
    }

    private List<String> splitChunks(String text, int chunkSize) {
        if (text.isEmpty()) {
            return List.of(" ");
        }
        int count = (text.length() + chunkSize - 1) / chunkSize;
        java.util.ArrayList<String> out = new java.util.ArrayList<>(count);
        for (int i = 0; i < text.length(); i += chunkSize) {
            out.add(text.substring(i, Math.min(text.length(), i + chunkSize)));
        }
        return out;
    }
}
