package top.katzenyasax.kuaikan.interaction.mq;

import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.client.producer.SendStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.interaction.domain.OutboxEvent;
import top.katzenyasax.kuaikan.interaction.mapper.OutboxMapper;

import java.time.LocalDateTime;
import java.util.List;

/**
 * outbox 轮询投递。
 *
 * <b>为什么不做"事务提交后立即发"</b>：那要两套代码路径（立即发 + 轮询兜底），
 * 而轮询最坏延迟 1 秒，远小于计数允许的 5 秒滞后。一条路径、可测、
 * 进程在提交后立刻崩溃也不会丢 —— 下次启动照样扫到这条。
 *
 * 单实例 + 单线程，所以不需要 {@code FOR UPDATE SKIP LOCKED}。
 * P7 上多实例时要么加它、要么加分布式锁 —— 那时才需要。
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    private final OutboxMapper outboxMapper;
    private final InteractionProducer producer;

    @Value("${kuaikan.outbox.batch-size:100}")
    private int batchSize;

    @Value("${kuaikan.outbox.max-retry:20}")
    private int maxRetry;

    /** 退避上限：5 分钟，避免无限增长 */
    private static final long MAX_BACKOFF_SECONDS = 300;

    public OutboxRelay(OutboxMapper outboxMapper, InteractionProducer producer) {
        this.outboxMapper = outboxMapper;
        this.producer = producer;
    }

    @Scheduled(fixedDelayString = "${kuaikan.outbox.relay-interval:1s}")
    public void relay() {
        List<OutboxEvent> pending = outboxMapper.pickPending(LocalDateTime.now(), batchSize);
        for (OutboxEvent row : pending) {
            try {
                // 用 eventId 作为消息 key：控制台里能直接按事件 id 查，
                // 也让重复投递在控制台上看起来是同一件事
                SendResult result = producer.send(row.getTopic(), row.getEventId(), row.getPayload());
                if (result != null && result.getSendStatus() == SendStatus.SEND_OK) {
                    outboxMapper.markSent(row.getId());
                } else {
                    retryOrAbandon(row, "sendStatus=" + (result == null ? "null" : result.getSendStatus()));
                }
            } catch (Exception e) {
                retryOrAbandon(row, e.toString());
            }
        }
        // 顺手清理已投递的老行（每天一次足够，这里用 id 取模来摊平，
        // 避免每轮都扫一遍全表）
        if (pending.isEmpty() && LocalDateTime.now().getMinute() == 0) {
            int purged = outboxMapper.purgeDelivered(LocalDateTime.now().minusDays(7));
            if (purged > 0) {
                log.info("已清理 {} 条已投递的 outbox 记录", purged);
            }
        }
    }

    private void retryOrAbandon(OutboxEvent row, String reason) {
        int next = (row.getRetryCount() == null ? 0 : row.getRetryCount()) + 1;
        if (next > maxRetry) {
            // 放弃后事件就真丢了 —— 这正是对账不是可选项的原因（ADR 0010）
            outboxMapper.markAbandoned(row.getId());
            log.error("outbox 超过重试上限，放弃 eventId={} topic={} reason={}",
                    row.getEventId(), row.getTopic(), reason);
            return;
        }
        long backoff = Math.min((1L << Math.min(next, 8)), MAX_BACKOFF_SECONDS);
        outboxMapper.scheduleRetry(row.getId(), LocalDateTime.now().plusSeconds(backoff));
        log.warn("outbox 投递失败，{} 秒后重试（第 {} 次）eventId={} reason={}",
                backoff, next, row.getEventId(), reason);
    }
}
