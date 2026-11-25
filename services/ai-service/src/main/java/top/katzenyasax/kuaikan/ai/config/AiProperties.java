package top.katzenyasax.kuaikan.ai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 服务核心配置（LLM 上游、超时、配额/预算限流、Stub 开关）。
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

    private int dailyQuota = 50;
    private long dailyTokenBudget = 5_000_000L;
    private int maxToolSteps = 5;
    private int historyTurns = 10;
    private int actionTtlMinutes = 30;
    private int summaryCacheHours = 24;
    private int retentionDays = 30;

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

    public int getDailyQuota() { return dailyQuota; }
    public void setDailyQuota(int dailyQuota) { this.dailyQuota = dailyQuota; }

    public long getDailyTokenBudget() { return dailyTokenBudget; }
    public void setDailyTokenBudget(long dailyTokenBudget) { this.dailyTokenBudget = dailyTokenBudget; }

    public int getMaxToolSteps() { return maxToolSteps; }
    public void setMaxToolSteps(int maxToolSteps) { this.maxToolSteps = maxToolSteps; }

    public int getHistoryTurns() { return historyTurns; }
    public void setHistoryTurns(int historyTurns) { this.historyTurns = historyTurns; }

    public int getActionTtlMinutes() { return actionTtlMinutes; }
    public void setActionTtlMinutes(int actionTtlMinutes) { this.actionTtlMinutes = actionTtlMinutes; }

    public int getSummaryCacheHours() { return summaryCacheHours; }
    public void setSummaryCacheHours(int summaryCacheHours) { this.summaryCacheHours = summaryCacheHours; }

    public int getRetentionDays() { return retentionDays; }
    public void setRetentionDays(int retentionDays) { this.retentionDays = retentionDays; }
}
