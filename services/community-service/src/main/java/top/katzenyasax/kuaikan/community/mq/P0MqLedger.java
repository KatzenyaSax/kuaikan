package top.katzenyasax.kuaikan.community.mq;

import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * P0 冒烟用的消费台账。
 *
 * 刻意存在内存里：P0 只验证「消息真的从 broker 走到了消费者」，
 * 不需要持久化。代价是容器重启即清空——这一点写进了 project.md，
 * 不要把它当成消息去重表。真正的消费幂等靠 t_consume_log（ADR 0004）。
 */
@Component
public class P0MqLedger {

    /** 防止被大量 smoke 消息撑爆内存 */
    private static final int MAX_ENTRIES = 10_000;

    private final Map<String, ConsumedRecord> records = new ConcurrentHashMap<>();

    public void record(String traceId, String msgId, long bornTimestamp) {
        if (records.size() >= MAX_ENTRIES) {
            return;
        }
        records.put(traceId, new ConsumedRecord(
                msgId, bornTimestamp, OffsetDateTime.now().toString()));
    }

    public Map<String, Object> snapshot(String traceId) {
        ConsumedRecord r = records.get(traceId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("traceId", traceId);
        body.put("received", r != null);
        body.put("consumer", "community-service");
        body.put("ledgerSize", records.size());
        if (r != null) {
            body.put("msgId", r.msgId());
            body.put("bornTimestamp", r.bornTimestamp());
            body.put("consumedAt", r.consumedAt());
        }
        return body;
    }

    public record ConsumedRecord(String msgId, long bornTimestamp, String consumedAt) {
    }
}
