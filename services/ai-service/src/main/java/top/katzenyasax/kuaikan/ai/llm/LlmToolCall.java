package top.katzenyasax.kuaikan.ai.llm;

public record LlmToolCall(
        String id,
        String name,
        String arguments
) {
}
