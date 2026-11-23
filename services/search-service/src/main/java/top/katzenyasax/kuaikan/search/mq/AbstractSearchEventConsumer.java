package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.MessageExt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 三个搜索侧消费者的共同骨架（Remoting，与 notification-service 的写法一致）。
 *
 * <h2>为什么抽基类</h2>
 *
 * 三个消费者的差异只有「topic / group / 载荷类型 / 处理动作」四件事，
 * 生命周期（启动重试、优雅关闭、批量遍历、失败重投）完全相同。
 * 复制三遍的话，任何一处生命周期修补都要改三个文件，而漏改一个的症状是
 * "这个消费者重启后就不工作了"——静默、且只在重启时暴露。
 *
 * <h2>消费语义</h2>
 *
 * <ul>
 *   <li>组名各自独立：RocketMQ 里 group 才代表"我是谁"，
 *       同 group 订阅同 topic 是负载均衡（各拿一半），不是广播</li>
 *   <li>{@code CONSUME_FROM_FIRST_OFFSET}：全新消费组从最早的消息开始，
 *       配合幂等写（覆盖 / 删 404 成功）不会漏历史事件</li>
 *   <li>处理抛异常 → {@code RECONSUME_LATER}。**绝不吞异常**：
 *       ES 抖一下就丢一条索引，等于永久脏数据</li>
 * </ul>
 *
 * <h2>为什么启动失败要重试而不是让进程退出</h2>
 *
 * compose 里 search-service 依赖 rmq-broker healthy，但 broker 仍可能与
 * nameserver 短暂失联。一个消费者起不来就让整个服务不可用是不划算的：
 * 索引会滞后，但服务本身（P6.3 的检索接口、health）应该照常工作。
 */
public abstract class AbstractSearchEventConsumer<T> {

    private final Logger log = LoggerFactory.getLogger(getClass());

    private final String name;
    private final String namesrvAddr;
    private final String consumerGroup;
    private final String topic;
    private final Class<T> payloadType;
    private final ObjectMapper json;

    private final ScheduledExecutorService retryExecutor;
    private volatile DefaultMQPushConsumer consumer;

    protected AbstractSearchEventConsumer(String name,
                                          String namesrvAddr,
                                          String consumerGroup,
                                          String topic,
                                          Class<T> payloadType,
                                          ObjectMapper json) {
        this.name = name;
        this.namesrvAddr = namesrvAddr;
        this.consumerGroup = consumerGroup;
        this.topic = topic;
        this.payloadType = payloadType;
        this.json = json;
        this.retryExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, name + "-retry");
            t.setDaemon(true);
            return t;
        });
    }

    /** 处理一条已反序列化的消息。抛异常 = 要求重投 */
    protected abstract void handle(T event) throws Exception;

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
            c.subscribe(topic, "*");
            c.registerMessageListener((MessageListenerConcurrently) (messages, context) -> {
                for (MessageExt message : messages) {
                    String payload = new String(message.getBody(), StandardCharsets.UTF_8);
                    try {
                        handle(json.readValue(payload, payloadType));
                    } catch (Exception e) {
                        log.error("搜索事件消费失败，将重投 msgId={} reconsumeTimes={} payload={}",
                                message.getMsgId(), message.getReconsumeTimes(),
                                payload.length() > 500 ? payload.substring(0, 500) + "…" : payload, e);
                        return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                    }
                }
                return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
            });
            c.start();
            this.consumer = c;
            log.info("搜索消费者已启动 namesrv={} topic={} group={}",
                    namesrvAddr, topic, consumerGroup);
        } catch (Exception e) {
            log.warn("搜索消费者启动失败，30 秒后重试 topic={} group={}：{}",
                    topic, consumerGroup, e.toString());
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
