package top.katzenyasax.kuaikan.common.outbox;

import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.client.producer.SendStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

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
 * 上多实例时要么加它、要么加分布式锁 —— 那时才需要。
 */
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    /** 退避上限：5 分钟，避免无限增长 */
    private static final long MAX_BACKOFF_SECONDS = 300;

    private final OutboxMapper outboxMapper;
    private final OutboxProducer producer;
    private final OutboxProperties properties;

    public OutboxRelay(OutboxMapper outboxMapper, OutboxProducer producer, OutboxProperties properties) {
        this.outboxMapper = outboxMapper;
        this.producer = producer;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${kuaikan.outbox.relay-interval:1s}")
    public void relay() {
        List<OutboxEvent> pending = outboxMapper.pickPending(LocalDateTime.now(), properties.getBatchSize());
        for (OutboxEvent row : pending) {
            try {
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
        // 顺手清理已投递的老行（每小时整点一次足够，避免每轮都扫一遍全表）
        if (pending.isEmpty() && LocalDateTime.now().getMinute() == 0) {
            int purged = outboxMapper.purgeDelivered(
                    LocalDateTime.now().minus(properties.getKeepDelivered()));
            if (purged > 0) {
                log.info("已清理 {} 条已投递的 outbox 记录", purged);
            }
        }
    }

    private void retryOrAbandon(OutboxEvent row, String reason) {
        int next = (row.getRetryCount() == null ? 0 : row.getRetryCount()) + 1;
        if (next > properties.getMaxRetry()) {
            // 放弃后事件就真丢了 —— 这正是对账不是可选项的原因（ADR 0010）。
            // 消息类事件的"对账"是人工重放：outbox 表必须可人工重放，这是它的主要价值。
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
