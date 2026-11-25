package top.katzenyasax.kuaikan.ai.llm;

import java.util.List;

public record LlmChatRequest(
        List<LlmMessage> messages,
        int maxTokens
) {
}
