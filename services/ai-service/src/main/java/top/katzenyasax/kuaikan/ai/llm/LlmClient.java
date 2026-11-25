package top.katzenyasax.kuaikan.ai.llm;

import reactor.core.publisher.Flux;

/**
 * LLM 流式对话客户端抽象，隔离真实 OpenAI 兼容协议与测试 Stub 实现。
 */
public interface LlmClient {

    Flux<LlmStreamChunk> streamChat(LlmChatRequest request, String stubScenario);
}
