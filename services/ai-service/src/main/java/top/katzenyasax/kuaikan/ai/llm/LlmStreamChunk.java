package top.katzenyasax.kuaikan.ai.llm;

import java.util.List;

public record LlmStreamChunk(
        String contentDelta,
        List<LlmToolCallDelta> toolCallDeltas,
        String finishReason,
        Integer promptTokens,
        Integer completionTokens
) {
}
