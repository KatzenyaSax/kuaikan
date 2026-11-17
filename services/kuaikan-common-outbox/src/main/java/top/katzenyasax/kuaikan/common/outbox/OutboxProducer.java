package top.katzenyasax.kuaikan.common.outbox;

import jakarta.annotation.PreDestroy;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * outbox 事件的生产者。把一条 outbox 行发到 RocketMQ。
 *
 * <b>用原生 rocketmq-client，不用 rocketmq-spring-boot-starter</b>（P0 时就定了这条）：
 * starter 的自动装配会把"发消息"变成一次立刻发生的调用，而我们要的是
 * outbox 轮询决定发什么、什么时候发。自己掌控时序，starter 反而挡路。
 *
 * <b>启动失败不拖垮应用</b>：记 warn 并 30 秒后重试。broker 晚于服务就绪时能自愈 ——
 * 这对 outbox 尤其重要：消息发不出去只意味着 outbox 里的行多躺一会儿。
 */
public class OutboxProducer {

    private static final Logger log = LoggerFactory.getLogger(OutboxProducer.class);

    private final String namesrvAddr;
    private final String producerGroup;
    private final String tag;

    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "outbox-mq-producer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQProducer producer;

    /**
     * @param applicationName 用作消息 tag（默认取 {@code spring.application.name}）。
     *                        tag 只是给人看的分类，消费端一律订阅 {@code "*"}，改它不影响投递。
     * @param producerGroup   为空时取 {@code applicationName + "-outbox-producer"}
     */
    public OutboxProducer(@Value("${spring.application.name:service}") String applicationName,
                          String namesrvAddr,
                          String producerGroup) {
        this.namesrvAddr = namesrvAddr;
        this.producerGroup = (producerGroup == null || producerGroup.isBlank())
                ? applicationName + "-outbox-producer"
                : producerGroup;
        this.tag = applicationName;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        tryStart();
    }

    private synchronized void tryStart() {
        if (producer != null) {
            return;
        }
        try {
            DefaultMQProducer p = new DefaultMQProducer(producerGroup);
            p.setNamesrvAddr(namesrvAddr);
            p.setSendMsgTimeout(3000);
            p.setRetryTimesWhenSendFailed(1);
            p.start();
            this.producer = p;
            log.info("outbox 生产者已启动 namesrv={} group={}", namesrvAddr, producerGroup);
        } catch (Exception e) {
            log.warn("outbox 生产者启动失败，30 秒后重试：{}", e.toString());
            retryExecutor.schedule(this::tryStart, 30, TimeUnit.SECONDS);
        }
    }

    /** 发送一条事件。失败抛异常，由调用方（OutboxRelay）决定重试还是放弃 */
    public SendResult send(String topic, String eventId, String payload) throws Exception {
        DefaultMQProducer p = producer;
        if (p == null) {
            throw new IllegalStateException("RocketMQ 生产者尚未就绪");
        }
        // 用 eventId 作为消息 key：控制台里能直接按事件 id 查，
        // 也让重复投递在控制台上看起来是同一件事
        Message message = new Message(topic, tag, eventId, payload.getBytes(StandardCharsets.UTF_8));
        return p.send(message);
    }

    @PreDestroy
    public void stop() {
        if (producer != null) {
            producer.shutdown();
        }
        retryExecutor.shutdownNow();
    }
}
