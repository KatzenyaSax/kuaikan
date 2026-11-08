package top.katzenyasax.kuaikan.community.mq;

import jakarta.annotation.PreDestroy;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.MessageExt;
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
 * P0 冒烟消费者。只用 Remoting（rocketmq-client），不用 Proxy（gRPC）。
 *
 * 启动失败不拖垮应用：记 warn 并每 30 秒重试，保证 broker 晚于服务就绪时也能自愈。
 */
@Component
public class P0MqConsumer {

    private static final Logger log = LoggerFactory.getLogger(P0MqConsumer.class);
    private static final String CONSUMER_GROUP = "kuaikan-p0-community-consumer";

    private final P0MqLedger ledger;
    private final String namesrvAddr;
    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "p0-mq-consumer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQPushConsumer consumer;

    public P0MqConsumer(P0MqLedger ledger,
                        @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr) {
        this.ledger = ledger;
        this.namesrvAddr = namesrvAddr;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        tryStart();
    }

    private synchronized void tryStart() {
        if (consumer != null) {
            return;
        }
        try {
            DefaultMQPushConsumer c = new DefaultMQPushConsumer(CONSUMER_GROUP);
            c.setNamesrvAddr(namesrvAddr);
            c.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_LAST_OFFSET);
            c.subscribe(Topics.P0_SMOKE, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String traceId = new String(message.getBody(), StandardCharsets.UTF_8);
                    ledger.record(traceId, message.getMsgId(), message.getBornTimestamp());
                    log.info("P0 消费成功 traceId={} msgId={} reconsumeTimes={}",
                            traceId, message.getMsgId(), message.getReconsumeTimes());
                }
                // 消费失败重试由 RocketMQ 负责；P0 的台账写内存不会失败
                return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
            });
            c.start();
            this.consumer = c;
            log.info("P0 消费者已启动 namesrv={} topic={} group={}",
                    namesrvAddr, Topics.P0_SMOKE, CONSUMER_GROUP);
        } catch (Exception e) {
            log.warn("P0 消费者启动失败，30 秒后重试：{}", e.toString());
            retryExecutor.schedule(this::tryStart, 30, TimeUnit.SECONDS);
        }
    }

    @PreDestroy
    public void stop() {
        if (consumer != null) {
            consumer.shutdown();
        }
        retryExecutor.shutdownNow();
    }
}
