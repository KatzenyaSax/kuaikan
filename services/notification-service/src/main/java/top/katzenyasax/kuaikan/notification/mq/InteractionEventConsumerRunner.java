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
 * 互动事件的消费端（点赞 / 收藏）。
 *
 * <b>消费组名必须与 content 的不同。</b>RocketMQ 里 topic 决定"哪些消息"，
 * group 决定"我是谁"：同一个 group 订阅同一个 topic 是**集群消费（负载均衡）**，
 * 两个服务各拿一半消息——点赞数只加一半、消息只出现一半，**而且不报任何错**。
 * 这是 P4 最容易踩、最难查的坑。
 *
 * <b>{@code CONSUME_FROM_FIRST_OFFSET}</b>：消费组第一次启动时从最早的消息开始读。
 * 否则 notification 上线前的历史互动事件会被跳过。
 */
@Component
public class InteractionEventConsumerRunner {

    private static final Logger log = LoggerFactory.getLogger(InteractionEventConsumerRunner.class);

    private final MessageService messageService;
    private final String namesrvAddr;
    private final String consumerGroup;

    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "notification-interaction-consumer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQPushConsumer consumer;

    public InteractionEventConsumerRunner(
            MessageService messageService,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.notify.interaction-consumer-group}") String consumerGroup) {
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
            c.subscribe(Topics.INTERACTION_CHANGED, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String payload = new String(message.getBody(), StandardCharsets.UTF_8);
                    boolean ok;
                    try {
                        ok = messageService.onInteractionChanged(payload);
                    } catch (Exception e) {
                        // 数据库异常、下游暂时不可用：让 MQ 重投。
                        // 幂等由 uk_user_event 保证，所以重投是安全的 ——
                        // 这正是"至少一次"能用的前提。
                        log.error("互动事件消费失败，将重投 msgId={} reconsumeTimes={}",
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
                    namesrvAddr, Topics.INTERACTION_CHANGED, consumerGroup);
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
