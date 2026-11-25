package top.katzenyasax.kuaikan.ai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 服务核心配置（LLM 上游、超时、Stub 开关）。
 */
@ConfigurationProperties(prefix = "kuaikan.ai")
public class AiProperties {

    private String baseUrl = "https://api.deepseek.com/v1";
    private String model = "deepseek-chat";
    private String apiKey = "";
    private boolean stubEnabled = true;
    private long connectTimeoutMs = 5000;
    private long firstTokenTimeoutMs = 20000;
    private long turnTimeoutMs = 90000;
    private int maxTokens = 2048;

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public boolean isStubEnabled() { return stubEnabled; }
    public void setStubEnabled(boolean stubEnabled) { this.stubEnabled = stubEnabled; }

    public long getConnectTimeoutMs() { return connectTimeoutMs; }
    public void setConnectTimeoutMs(long connectTimeoutMs) { this.connectTimeoutMs = connectTimeoutMs; }

    public long getFirstTokenTimeoutMs() { return firstTokenTimeoutMs; }
    public void setFirstTokenTimeoutMs(long firstTokenTimeoutMs) { this.firstTokenTimeoutMs = firstTokenTimeoutMs; }

    public long getTurnTimeoutMs() { return turnTimeoutMs; }
    public void setTurnTimeoutMs(long turnTimeoutMs) { this.turnTimeoutMs = turnTimeoutMs; }

    public int getMaxTokens() { return maxTokens; }
    public void setMaxTokens(int maxTokens) { this.maxTokens = maxTokens; }
}
