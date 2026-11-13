package top.katzenyasax.kuaikan.content.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.mq.InteractionChange;
import top.katzenyasax.kuaikan.content.domain.ConsumeLog;
import top.katzenyasax.kuaikan.content.mapper.ConsumeLogMapper;
import top.katzenyasax.kuaikan.content.mapper.CountProjectionMapper;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * 消费互动事件，把计数投影到 content 自己的表上。
 *
 * <b>幂等的两层都在这里</b>：
 *   1. 写事实时的唯一键（interaction 侧，重复点赞根本不产生事件）
 *   2. {@code t_consume_log(event_id, consumer)} —— 挡重复投递
 * 第 3 层是对账（CountReconciler），在别处。
 *
 * <b>去重记录与计数更新必须同事务</b>：先改计数再记日志，中间崩溃重投时会 +2；
 * 先记日志再改计数同样错。只能一起提交。
 */
@Service
public class InteractionEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(InteractionEventConsumer.class);

    /** 消费者标识。将来 search-service 消费同一批事件时用另一个名字，各记各的 */
    public static final String CONSUMER = "content-like-count";

    private final ConsumeLogMapper consumeLogMapper;
    private final CountProjectionMapper projectionMapper;
    private final ObjectMapper objectMapper;

    public InteractionEventConsumer(ConsumeLogMapper consumeLogMapper,
                                    CountProjectionMapper projectionMapper,
                                    ObjectMapper objectMapper) {
        this.consumeLogMapper = consumeLogMapper;
        this.projectionMapper = projectionMapper;
        this.objectMapper = objectMapper;
    }

    /**
     * @return true = 处理成功（含"已消费过"）；false = 失败，需要 MQ 重投
     */
    @Transactional
    public boolean handle(String rawPayload) {
        InteractionChange event;
        try {
            event = objectMapper.readValue(rawPayload, InteractionChange.class);
        } catch (Exception e) {
            // 反序列化不了的消息重投多少次都没用 —— 记 ERROR 并**返回成功**，
            // 让它进入 MQ 的死信队列，而不是无限重试堵住整个消费组。
            log.error("事件反序列化失败，丢弃 payload={}", rawPayload, e);
            return true;
        }

        ConsumeLog row = new ConsumeLog();
        row.setEventId(event.eventId());
        row.setConsumer(CONSUMER);
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
        if (consumeLogMapper.insertIgnore(row) == 0) {
            log.info("重复投递，已忽略 eventId={}", event.eventId());
            return true;
        }

        Long targetId = Long.parseLong(event.targetId());
        int delta = event.change() == InteractionChange.Change.ADDED ? 1 : -1;

        int rows = switch (event.kind()) {
            case LIKE -> event.targetType() == InteractionChange.TargetType.POST
                    ? projectionMapper.applyPostLike(targetId, delta)
                    : projectionMapper.applyCommentLike(targetId, delta);
            case FAVORITE -> projectionMapper.applyPostFavorite(targetId, delta);
        };
        if (rows == 0) {
            // 目标已被删除，或计数已经在下界（重复的 REMOVED）。
            // 不是错误：事实仍然算数，对账会把它算进去。
            log.warn("计数未更新（目标不存在或已在下界）eventId={} target={}:{}",
                    event.eventId(), event.targetType(), targetId);
        }
        log.info("事件已消费 eventId={} kind={} change={} target={}:{}",
                event.eventId(), event.kind(), event.change(), event.targetType(), targetId);
        return true;
    }
}
