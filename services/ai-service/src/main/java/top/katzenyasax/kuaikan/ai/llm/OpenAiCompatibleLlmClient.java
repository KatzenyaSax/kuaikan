package top.katzenyasax.kuaikan.ai.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 基于 OpenAI 兼容 Chat Completions 协议的流式客户端（默认对接 DeepSeek）。
 */
@Component
public class OpenAiCompatibleLlmClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatibleLlmClient.class);
    private static final ParameterizedTypeReference<ServerSentEvent<String>> SSE_TYPE =
            new ParameterizedTypeReference<>() {};

    private final WebClient webClient;
    private final AiProperties props;
    private final ObjectMapper objectMapper;

    public OpenAiCompatibleLlmClient(WebClient aiWebClient, AiProperties props, ObjectMapper objectMapper) {
        this.webClient = aiWebClient;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @Override
    public Flux<LlmStreamChunk> streamChat(LlmChatRequest request, String stubScenario) {
        String apiKey = props.getApiKey();
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("LLM 调用跳过：未配置 DEEPSEEK_API_KEY");
            return Flux.error(new BizException(AiErrorCode.AI_UNAVAILABLE));
        }

        String baseUrl = props.getBaseUrl() == null ? "" : props.getBaseUrl().replaceAll("/+$", "");
        if (baseUrl.isBlank()) {
            log.warn("LLM 调用跳过：base-url 为空");
            return Flux.error(new BizException(AiErrorCode.AI_UNAVAILABLE));
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", props.getModel());
        body.put("stream", true);
        body.put("stream_options", Map.of("include_usage", true));
        body.put("max_tokens", request.maxTokens() > 0 ? request.maxTokens() : props.getMaxTokens());
        body.put("messages", request.messages().stream().map(this::serializeMessage).toList());
        if (request.tools() != null && !request.tools().isEmpty()) {
            body.put("tools", request.tools());
            if (request.toolChoice() != null && !request.toolChoice().isBlank()) {
                body.put("tool_choice", request.toolChoice());
            }
        }

        return webClient.post()
                .uri(baseUrl + "/chat/completions")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey.trim())
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body)
                .retrieve()
                .onStatus(HttpStatusCode::isError, resp -> resp.bodyToMono(String.class)
                        .defaultIfEmpty("")
                        .flatMap(errBody -> {
                            log.warn("LLM 上游返回错误状态 status={} bodyLen={}",
                                    resp.statusCode().value(), errBody.length());
                            return Mono.error(new BizException(AiErrorCode.AI_UNAVAILABLE));
                        }))
                .bodyToFlux(SSE_TYPE)
                .mapNotNull(ServerSentEvent::data)
                .map(String::trim)
                .filter(data -> !data.isEmpty())
                .takeWhile(data -> !"[DONE]".equals(data))
                .map(this::parseChunk)
                .timeout(Duration.ofMillis(props.getFirstTokenTimeoutMs()))
                .onErrorMap(e -> {
                    if (e instanceof BizException be) {
                        return be;
                    }
                    log.warn("LLM 流式调用异常: {}", e.toString());
                    return new BizException(AiErrorCode.AI_UNAVAILABLE);
                });
    }

    private Map<String, Object> serializeMessage(LlmMessage m) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("role", m.role());
        if ("tool".equals(m.role())) {
            map.put("tool_call_id", m.toolCallId());
            map.put("content", m.content() != null ? m.content() : "");
            return map;
        }
        if ("assistant".equals(m.role()) && m.toolCalls() != null && !m.toolCalls().isEmpty()) {
            map.put("content", m.content() != null ? m.content() : "");
            List<Map<String, Object>> tcs = new ArrayList<>(m.toolCalls().size());
            for (LlmToolCall tc : m.toolCalls()) {
                tcs.add(Map.of(
                        "id", tc.id(),
                        "type", "function",
                        "function", Map.of(
                                "name", tc.name(),
                                "arguments", tc.arguments() != null ? tc.arguments() : "{}"
                        )
                ));
            }
            map.put("tool_calls", tcs);
            return map;
        }
        map.put("content", m.content() != null ? m.content() : "");
        return map;
    }

    private LlmStreamChunk parseChunk(String json) {
        try {
            JsonNode root = objectMapper.readTree(json);
            String contentDelta = null;
            String finishReason = null;
            List<LlmToolCallDelta> toolCallDeltas = List.of();

            JsonNode choices = root.path("choices");
            if (choices.isArray() && !choices.isEmpty()) {
                JsonNode first = choices.get(0);
                JsonNode fr = first.path("finish_reason");
                if (fr.isTextual()) {
                    finishReason = fr.asText();
                }
                JsonNode delta = first.path("delta");
                JsonNode contentNode = delta.path("content");
                if (contentNode.isTextual()) {
                    contentDelta = contentNode.asText();
                }
                JsonNode tcArray = delta.path("tool_calls");
                if (tcArray.isArray() && !tcArray.isEmpty()) {
                    List<LlmToolCallDelta> list = new ArrayList<>(tcArray.size());
                    for (JsonNode tc : tcArray) {
                        int idx = tc.path("index").asInt(0);
                        String id = tc.path("id").isTextual() ? tc.get("id").asText() : null;
                        JsonNode fn = tc.path("function");
                        String name = fn.path("name").isTextual() ? fn.get("name").asText() : null;
                        String args = fn.path("arguments").isTextual() ? fn.get("arguments").asText() : null;
                        list.add(new LlmToolCallDelta(idx, id, name, args));
                    }
                    toolCallDeltas = list;
                }
            }

            Integer promptTokens = null;
            Integer completionTokens = null;
            JsonNode usage = root.path("usage");
            if (usage.isObject()) {
                if (usage.path("prompt_tokens").isNumber()) {
                    promptTokens = usage.get("prompt_tokens").asInt();
                }
                if (usage.path("completion_tokens").isNumber()) {
                    completionTokens = usage.get("completion_tokens").asInt();
                }
            }

            return new LlmStreamChunk(contentDelta, toolCallDeltas, finishReason, promptTokens, completionTokens);
        } catch (Exception e) {
            log.warn("解析 LLM SSE 分片失败: {}", e.toString());
            return new LlmStreamChunk(null, List.of(), null, null, null);
        }
    }
}
