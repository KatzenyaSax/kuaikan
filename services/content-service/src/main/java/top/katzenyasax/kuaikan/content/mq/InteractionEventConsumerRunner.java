package top.katzenyasax.kuaikan.content.mq;

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
import top.katzenyasax.kuaikan.content.service.InteractionEventConsumer;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 互动事件的消费端。
 *
 * <b>{@code CONSUME_FROM_FIRST_OFFSET}</b>：消费组第一次启动时从最早的消息开始读。
 * 这一条对 L4 的"kill content-service 再点赞"很关键——content 停机期间
 * 产生的事件必须在它启动后被消费，而不是被跳过。
 *
 * 消费失败返回 {@code RECONSUME_LATER}，由 RocketMQ 按退避重投。
 */
@Component
public class InteractionEventConsumerRunner {

    private static final Logger log = LoggerFactory.getLogger(InteractionEventConsumerRunner.class);
    private static final String CONSUMER_GROUP = "kuaikan-content-interaction-consumer";

    private final InteractionEventConsumer handler;
    private final String namesrvAddr;
    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "interaction-consumer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQPushConsumer consumer;

    public InteractionEventConsumerRunner(InteractionEventConsumer handler,
                                          @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr) {
        this.handler = handler;
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
            c.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
            c.subscribe(Topics.INTERACTION_CHANGED, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String payload = new String(message.getBody(), StandardCharsets.UTF_8);
                    boolean ok;
                    try {
                        ok = handler.handle(payload);
                    } catch (Exception e) {
                        // 数据库异常等：让 MQ 重投。幂等由 t_consume_log 保证，
                        // 所以重投是安全的 —— 这正是"至少一次"能用的前提。
                        log.error("消费失败，将重投 msgId={} reconsumeTimes={}",
                                message.getMsgId(), message.getReconsumeTimes(), e);
                        ok = false;
                    }
                    if (!ok) {
                        return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                    }
                }
                return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
            });
            c.start();
            this.consumer = c;
            log.info("互动事件消费者已启动 namesrv={} topic={} group={}",
                    namesrvAddr, Topics.INTERACTION_CHANGED, CONSUMER_GROUP);
        } catch (Exception e) {
            log.warn("互动事件消费者启动失败，30 秒后重试：{}", e.toString());
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
