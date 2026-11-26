package top.katzenyasax.kuaikan.search.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 搜索侧基础设施参数。前缀 {@code kuaikan.search}。
 *
 * <h2>为什么 ES 的超时要**短**</h2>
 *
 * 这里的调用只有两种来源：MQ 消费线程和重建任务，都不是用户请求。
 * ES 卡住时，长超时只会让消费组积压、重建脚本挂死；
 * 短超时（连接 3s / 读 10s）让失败尽快暴露，交给 MQ 重投或下一次重建。
 *
 * <h2>为什么写超时比读超时长</h2>
 *
 * 重建的 {@code _bulk} 一次 500 条，读超时给到 10s；
 * 而消费端的单文档写入同样走这个客户端，它远快于 10s，不影响正常路径。
 * 分成两套客户端没有收益——这是同一个 ES、同一条链路。
 */
@ConfigurationProperties(prefix = "kuaikan.search")
public class SearchProperties {

    /** ES 地址。纯内网，无认证（compose 里 security 关闭） */
    private String elasticsearchUri = "http://127.0.0.1:9200";

    /** 建立 TCP 连接的超时 */
    private Duration connectTimeout = Duration.ofSeconds(3);

    /** 等响应的超时。重建的 bulk 也在其中，所以不能给 1s */
    private Duration readTimeout = Duration.ofSeconds(10);

    /** 重建时每页向 content 拉多少条。content 侧上限 500，覆盖上限 200 */
    private int rebuildPageSize = 200;

    /** 重建时一次 bulk 写多少条。ES 对单次体积敏感，500 是保守值 */
    private int bulkSize = 500;

    /** P9.0 Embedding 推理与混合检索参数 */
    private Embedding embedding = new Embedding();

    public Embedding getEmbedding() {
        return embedding;
    }

    public void setEmbedding(Embedding embedding) {
        this.embedding = embedding;
    }

    public static class Embedding {
        private String baseUrl = "http://127.0.0.1:8089";
        private String model = "BAAI/bge-small-zh-v1.5";
        private String apiKey = "";
        private Duration connectTimeout = Duration.ofSeconds(3);
        private Duration readTimeout = Duration.ofSeconds(15);
        private int batchSize = 16;
        private int rrfK = 60;
        private double relatedMinScore = 0.78;

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public String getModel() {
            return model;
        }

        public void setModel(String model) {
            this.model = model;
        }

        public String getApiKey() {
            return apiKey;
        }

        public void setApiKey(String apiKey) {
            this.apiKey = apiKey;
        }

        public Duration getConnectTimeout() {
            return connectTimeout;
        }

        public void setConnectTimeout(Duration connectTimeout) {
            this.connectTimeout = connectTimeout;
        }

        public Duration getReadTimeout() {
            return readTimeout;
        }

        public void setReadTimeout(Duration readTimeout) {
            this.readTimeout = readTimeout;
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            this.batchSize = batchSize;
        }

        public int getRrfK() {
            return rrfK;
        }

        public void setRrfK(int rrfK) {
            this.rrfK = rrfK;
        }

        public double getRelatedMinScore() {
            return relatedMinScore;
        }

        public void setRelatedMinScore(double relatedMinScore) {
            this.relatedMinScore = relatedMinScore;
        }
    }

    public String getElasticsearchUri() {
        return elasticsearchUri;
    }

    public void setElasticsearchUri(String elasticsearchUri) {
        this.elasticsearchUri = elasticsearchUri;
    }

    public Duration getConnectTimeout() {
        return connectTimeout;
    }

    public void setConnectTimeout(Duration connectTimeout) {
        this.connectTimeout = connectTimeout;
    }

    public Duration getReadTimeout() {
        return readTimeout;
    }

    public void setReadTimeout(Duration readTimeout) {
        this.readTimeout = readTimeout;
    }

    public int getRebuildPageSize() {
        return rebuildPageSize;
    }

    public void setRebuildPageSize(int rebuildPageSize) {
        this.rebuildPageSize = rebuildPageSize;
    }

    public int getBulkSize() {
        return bulkSize;
    }

    public void setBulkSize(int bulkSize) {
        this.bulkSize = bulkSize;
    }
}
