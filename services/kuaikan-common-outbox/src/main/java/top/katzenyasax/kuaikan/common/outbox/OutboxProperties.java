package top.katzenyasax.kuaikan.common.outbox;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * outbox 的配置项。前缀 {@code kuaikan.outbox}。
 *
 * <b>为什么用 @ConfigurationProperties 而不是 @Value</b>：
 * {@code @Value} 绑不了 YAML 列表，而这里的配置以后大概率会变成
 * "按 topic 配置不同优先级"之类的结构。现在就用对的形式，省一次改写。
 *
 * <b>这里为什么没有 namesrv</b>：MQ 地址属于 MQ 的配置，不属于 outbox。
 * 消费端和投递端共用同一个 {@code kuaikan.mq.namesrv-addr}，
 * 在这里再放一份就会出现"改了一个不生效"。
 *
 * <b>轮询间隔也不在这里</b>：它由 {@code OutboxRelay} 的
 * {@code @Scheduled(fixedDelayString = "${kuaikan.outbox.relay-interval:1s}")}
 * 直接从 Environment 读。
 */
@ConfigurationProperties(prefix = "kuaikan.outbox")
public class OutboxProperties {

    /**
     * 总开关。<b>默认关闭，必须显式打开。</b>
     *
     * 不开的后果只是"不发事件"；而误开的后果是**每秒扫一张不存在的表**，
     * 日志刷屏且掩盖真正的错误。所以宁可让使用者多写一行配置。
     */
    private boolean enabled = false;

    /** 每轮最多取多少条 */
    private int batchSize = 100;

    /** 超过这个次数就放弃（status=2）。放弃后事件真丢了，靠对账/人工重放兜底 */
    private int maxRetry = 20;

    /**
     * 生产者组的名字。空字符串表示自动取
     * {@code ${spring.application.name}-outbox-producer}。
     *
     * 每个服务用不同的组名不是硬性要求（我们不用事务消息，没有回查），
     * 但排查时能在控制台一眼看出是谁发的，值这一行。
     */
    private String producerGroup = "";

    /** 已投递的行保留多久后清理，否则表会无限增长 */
    private Duration keepDelivered = Duration.ofDays(7);

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) { this.batchSize = batchSize; }
    public int getMaxRetry() { return maxRetry; }
    public void setMaxRetry(int maxRetry) { this.maxRetry = maxRetry; }
    public String getProducerGroup() { return producerGroup; }
    public void setProducerGroup(String producerGroup) { this.producerGroup = producerGroup; }
    public Duration getKeepDelivered() { return keepDelivered; }
    public void setKeepDelivered(Duration keepDelivered) { this.keepDelivered = keepDelivered; }
}
