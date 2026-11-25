package top.katzenyasax.kuaikan.ai.llm;

import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import top.katzenyasax.kuaikan.ai.config.AiProperties;

/**
 * 根据配置开关与内网 Stub 头路由至真实模型或 Stub 实现。
 */
@Component
public class LlmRouter {

    private final AiProperties props;
    private final OpenAiCompatibleLlmClient realClient;
    private final StubLlmClient stubClient;

    public LlmRouter(AiProperties props,
                     OpenAiCompatibleLlmClient realClient,
                     StubLlmClient stubClient) {
        this.props = props;
        this.realClient = realClient;
        this.stubClient = stubClient;
    }

    public Flux<LlmStreamChunk> streamChat(LlmChatRequest request, String stubScenario) {
        if (props.isStubEnabled() && stubScenario != null && !stubScenario.isBlank()) {
            return stubClient.streamChat(request, stubScenario.trim());
        }
        return realClient.streamChat(request, null);
    }
}
