package top.katzenyasax.kuaikan.notification.mq;

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
import top.katzenyasax.kuaikan.notification.service.MessageService;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 关注事件的消费端 —— FOLLOW 分类的唯一来源（P5.5.1）。
 *
 * <b>独立的消费组 {@code kuaikan-notification-follow-consumer}</b>（p55-social.md §4.2）。
 * 绝不复用既有组名：RocketMQ 里 topic 决定"哪些消息"、group 决定"我是谁"，
 * 同一个 group 订阅同一个 topic 是集群消费（各拿一半），而且**不报任何错**——
 * 这是 P4 最难查的坑（p4-notification.md §6.1）。
 *
 * <b>{@code CONSUME_FROM_FIRST_OFFSET}</b> 与另外三个消费者一致：消费组第一次启动时
 * 从最早的消息开始读，否则上线前的历史关注事件会被跳过。
 */
@Component
public class FollowEventConsumerRunner {

    private static final Logger log = LoggerFactory.getLogger(FollowEventConsumerRunner.class);

    private final MessageService messageService;
    private final String namesrvAddr;
    private final String consumerGroup;

    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "notification-follow-consumer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQPushConsumer consumer;

    public FollowEventConsumerRunner(
            MessageService messageService,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.notify.follow-consumer-group}") String consumerGroup) {
        this.messageService = messageService;
        this.namesrvAddr = namesrvAddr;
        this.consumerGroup = consumerGroup;
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
            DefaultMQPushConsumer c = new DefaultMQPushConsumer(consumerGroup);
            c.setNamesrvAddr(namesrvAddr);
            c.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
            c.subscribe(Topics.USER_FOLLOWED, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String payload = new String(message.getBody(), StandardCharsets.UTF_8);
                    boolean ok;
                    try {
                        // 内部已处理自抑制、24h 冷却与幂等；命中任一条都返回 true（正常 ACK）
                        ok = messageService.onUserFollowed(payload);
                    } catch (Exception e) {
                        log.error("关注事件消费失败，将重投 msgId={} reconsumeTimes={}",
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
            log.info("关注事件消费者已启动 namesrv={} topic={} group={}",
                    namesrvAddr, Topics.USER_FOLLOWED, consumerGroup);
        } catch (Exception e) {
            log.warn("关注事件消费者启动失败，30 秒后重试：{}", e.toString());
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
