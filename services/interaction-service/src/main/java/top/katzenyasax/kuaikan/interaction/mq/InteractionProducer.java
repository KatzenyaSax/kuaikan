package top.katzenyasax.kuaikan.interaction.mq;

import jakarta.annotation.PreDestroy;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 互动事件的生产者。
 *
 * **用原生 rocketmq-client，不用 rocketmq-spring-boot-starter**（P0 时就定了这条）：
 * starter 的自动装配会把"发消息"变成一次立刻发生的调用，而我们要的是
 * outbox 轮询决定发什么、什么时候发。自己掌控时序，starter 反而挡路。
 *
 * 启动失败不拖垮应用：记 warn 并 30 秒后重试。broker 晚于服务就绪时能自愈——
 * 这对 outbox 尤其重要：消息发不出去只意味着 outbox 里的行多躺一会儿。
 */
@Component
public class InteractionProducer {

    private static final Logger log = LoggerFactory.getLogger(InteractionProducer.class);
    private static final String PRODUCER_GROUP = "kuaikan-interaction-producer";

    private final String namesrvAddr;
    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "interaction-mq-producer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQProducer producer;

    public InteractionProducer(@Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr) {
        this.namesrvAddr = namesrvAddr;
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
            DefaultMQProducer p = new DefaultMQProducer(PRODUCER_GROUP);
            p.setNamesrvAddr(namesrvAddr);
            p.setSendMsgTimeout(3000);
            p.setRetryTimesWhenSendFailed(1);
            p.start();
            this.producer = p;
            log.info("互动事件生产者已启动 namesrv={} group={}", namesrvAddr, PRODUCER_GROUP);
        } catch (Exception e) {
            log.warn("互动事件生产者启动失败，30 秒后重试：{}", e.toString());
            retryExecutor.schedule(this::tryStart, 30, TimeUnit.SECONDS);
        }
    }

    /** 发送一条事件。失败抛异常，由调用方（OutboxRelay）决定重试还是放弃 */
    public SendResult send(String topic, String eventId, String payload) throws Exception {
        DefaultMQProducer p = producer;
        if (p == null) {
            throw new IllegalStateException("RocketMQ 生产者尚未就绪");
        }
        Message message = new Message(topic, "interaction", eventId,
                payload.getBytes(StandardCharsets.UTF_8));
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
