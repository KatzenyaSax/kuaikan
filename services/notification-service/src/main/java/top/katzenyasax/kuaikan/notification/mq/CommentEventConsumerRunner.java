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
 * 评论事件的消费端。
 *
 * <b>与互动消费者的 group 不同</b>（`kuaikan-notification-comment-consumer`）。
 * 它们订阅的是不同 topic，但即使订阅同一个 topic，组名也必须不同——
 * 同 group 是集群消费（各拿一半），不是广播。
 */
@Component
public class CommentEventConsumerRunner {

    private static final Logger log = LoggerFactory.getLogger(CommentEventConsumerRunner.class);

    private final MessageService messageService;
    private final String namesrvAddr;
    private final String consumerGroup;

    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "notification-comment-consumer-retry");
                t.setDaemon(true);
                return t;
            });

    private volatile DefaultMQPushConsumer consumer;

    public CommentEventConsumerRunner(
            MessageService messageService,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.notify.comment-consumer-group}") String consumerGroup) {
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
            c.subscribe(Topics.COMMENT_CREATED, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String payload = new String(message.getBody(), StandardCharsets.UTF_8);
                    boolean ok;
                    try {
                        ok = messageService.onCommentCreated(payload);
                    } catch (Exception e) {
                        log.error("评论事件消费失败，将重投 msgId={} reconsumeTimes={}",
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
            log.info("评论事件消费者已启动 namesrv={} topic={} group={}",
                    namesrvAddr, Topics.COMMENT_CREATED, consumerGroup);
        } catch (Exception e) {
            log.warn("评论事件消费者启动失败，30 秒后重试：{}", e.toString());
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
