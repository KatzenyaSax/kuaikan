package top.katzenyasax.kuaikan.user.mq;

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
import top.katzenyasax.kuaikan.common.mq.Topics;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * P0 冒烟生产者。用原生 rocketmq-client 而非 rocketmq-spring-boot-starter，
 * 因为后续 P3 需要自己掌控 outbox → 发送的时序，starter 的自动装配反而挡路。
 *
 * 启动失败不会拖垮应用：记 warn 并 30 秒后重试，保证 broker 晚于服务就绪时也能自愈。
 */
@Component
public class P0MqProducer {

    private static final Logger log = LoggerFactory.getLogger(P0MqProducer.class);
    private static final String PRODUCER_GROUP = "kuaikan-p0-user-producer";

    private final String namesrvAddr;
    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "p0-mq-producer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQProducer producer;

    public P0MqProducer(@Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr) {
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
            log.info("P0 生产者已启动 namesrv={} group={}", namesrvAddr, PRODUCER_GROUP);
        } catch (Exception e) {
            log.warn("P0 生产者启动失败，30 秒后重试：{}", e.toString());
            retryExecutor.schedule(this::tryStart, 30, TimeUnit.SECONDS);
        }
    }

    public SendResult send(String traceId) throws Exception {
        DefaultMQProducer p = producer;
        if (p == null) {
            throw new IllegalStateException("RocketMQ 生产者尚未就绪");
        }
        Message message = new Message(Topics.P0_SMOKE, "smoke", traceId, traceId.getBytes(StandardCharsets.UTF_8));
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
