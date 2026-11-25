package top.katzenyasax.kuaikan.ai.llm;

import java.util.List;

public record LlmMessage(
        String role,
        String content,
        List<LlmToolCall> toolCalls,
        String toolCallId
) {
    public static LlmMessage system(String content) {
        return new LlmMessage("system", content, null, null);
    }

    public static LlmMessage user(String content) {
        return new LlmMessage("user", content, null, null);
    }

    public static LlmMessage assistant(String content) {
        return new LlmMessage("assistant", content, null, null);
    }

    public static LlmMessage assistantToolCalls(String content, List<LlmToolCall> toolCalls) {
        return new LlmMessage("assistant", content, toolCalls, null);
    }

    public static LlmMessage tool(String toolCallId, String content) {
        return new LlmMessage("tool", content, null, toolCallId);
    }
}
