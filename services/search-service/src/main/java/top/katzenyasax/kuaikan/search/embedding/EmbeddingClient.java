package top.katzenyasax.kuaikan.search.embedding;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import top.katzenyasax.kuaikan.search.config.SearchProperties;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * OpenAI 兼容 {@code /v1/embeddings} 客户端（P9.0）。
 *
 * <p>默认对接内网自托管 TEI 容器，代码仅依赖 {@code POST /v1/embeddings} 协议，
 * 切换云端提供商只需修改配置。所有请求与响应体统一走 UTF-8 {@code byte[]}，
 * 避免 Spring 默认 ISO-8859-1 损坏中文文本。
 */
@Component
public class EmbeddingClient {

    private static final int EXPECTED_DIMS = 512;

    private final RestClient rest;
    private final ObjectMapper json;
    private final SearchProperties.Embedding config;

    public EmbeddingClient(ObjectMapper json, SearchProperties props) {
        this.json = json;
        this.config = props.getEmbedding();
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(config.getConnectTimeout())
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(config.getReadTimeout());
        String baseUrl = config.getBaseUrl() == null ? "" : config.getBaseUrl().replaceAll("/+$", "");
        this.rest = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    /** 将单条文本编码为向量 */
    public float[] embedOne(String text) {
        List<float[]> vectors = embed(List.of(text == null ? "" : text));
        return vectors.get(0);
    }

    /** 按配置的 batchSize 分批请求，返回与入参一一对应的向量列表 */
    public List<float[]> embed(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        int batchSize = Math.max(1, config.getBatchSize());
        List<float[]> out = new ArrayList<>(texts.size());
        for (int from = 0; from < texts.size(); from += batchSize) {
            List<String> batch = texts.subList(from, Math.min(from + batchSize, texts.size()));
            out.addAll(embedBatch(batch));
        }
        return out;
    }

    private List<float[]> embedBatch(List<String> batch) {
        Map<String, Object> body = new LinkedHashMap<>(2);
        body.put("model", config.getModel());
        body.put("input", batch);
        String payload = write(body);

        String response;
        try {
            RestClient.RequestBodySpec req = rest.post()
                    .uri("/v1/embeddings")
                    .contentType(MediaType.APPLICATION_JSON);
            if (config.getApiKey() != null && !config.getApiKey().isBlank()) {
                req.header(HttpHeaders.AUTHORIZATION, "Bearer " + config.getApiKey().strip());
            }
            byte[] raw = req.body(payload.getBytes(StandardCharsets.UTF_8))
                    .retrieve()
                    .body(byte[].class);
            response = raw == null ? "{}" : new String(raw, StandardCharsets.UTF_8);
        } catch (RestClientResponseException e) {
            throw new IllegalStateException("Embedding 请求失败：HTTP " + e.getStatusCode().value()
                    + " " + e.getResponseBodyAsString(), e);
        }

        JsonNode root = readTree(response);
        JsonNode data = root.path("data");
        if (!data.isArray() || data.size() != batch.size()) {
            throw new IllegalStateException("Embedding 返回条数不匹配：expected=" + batch.size()
                    + " actual=" + data.size());
        }

        record IndexedVector(int index, float[] vector) {}
        List<IndexedVector> items = new ArrayList<>(data.size());
        for (int i = 0; i < data.size(); i++) {
            JsonNode node = data.get(i);
            int idx = node.path("index").asInt(i);
            JsonNode embNode = node.path("embedding");
            if (!embNode.isArray() || embNode.size() != EXPECTED_DIMS) {
                throw new IllegalStateException("Embedding 维度异常：expected=" + EXPECTED_DIMS
                        + " actual=" + embNode.size());
            }
            float[] vec = new float[embNode.size()];
            for (int d = 0; d < embNode.size(); d++) {
                vec[d] = (float) embNode.get(d).asDouble();
            }
            items.add(new IndexedVector(idx, vec));
        }
        items.sort(Comparator.comparingInt(IndexedVector::index));
        return items.stream().map(IndexedVector::vector).toList();
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("序列化 Embedding 请求失败", e);
        }
    }

    private JsonNode readTree(String body) {
        try {
            return json.readTree(body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("解析 Embedding 响应失败", e);
        }
    }
}
