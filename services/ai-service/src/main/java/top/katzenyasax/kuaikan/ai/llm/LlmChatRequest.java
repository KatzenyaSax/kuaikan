package top.katzenyasax.kuaikan.ai.llm;

import java.util.List;
import java.util.Map;

public record LlmChatRequest(
        List<LlmMessage> messages,
        int maxTokens,
        List<Map<String, Object>> tools,
        String toolChoice
) {
    public LlmChatRequest(List<LlmMessage> messages, int maxTokens) {
        this(messages, maxTokens, List.of(), null);
    }
}
