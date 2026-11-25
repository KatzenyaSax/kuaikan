package top.katzenyasax.kuaikan.ai.llm;

public record LlmToolCallDelta(
        int index,
        String id,
        String name,
        String argumentsDelta
) {
}
