package top.katzenyasax.kuaikan.notification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.mq.InteractionChange;
import top.katzenyasax.kuaikan.notification.domain.Message;
import top.katzenyasax.kuaikan.notification.mapper.MessageMapper;
import top.katzenyasax.kuaikan.notification.service.SnapshotService.Actor;
import top.katzenyasax.kuaikan.notification.service.SnapshotService.Target;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * 把「事实」变成「消息」。
 *
 * 这一层只做三件事：判断该不该发、拉快照、幂等落库。
 * 具体消息文本由前端拼（"某人 赞了你的《标题》"），后端只给结构化的字段——
 * 文案是展示层的事，改文案不该动后端。
 */
@Service
public class MessageService {

    private static final Logger log = LoggerFactory.getLogger(MessageService.class);

    private static final int EXCERPT_MAX = 120;

    private final MessageMapper messageMapper;
    private final SnapshotService snapshotService;
    private final ObjectMapper objectMapper;

    public MessageService(MessageMapper messageMapper,
                          SnapshotService snapshotService,
                          ObjectMapper objectMapper) {
        this.messageMapper = messageMapper;
        this.snapshotService = snapshotService;
        this.objectMapper = objectMapper;
    }

    /**
     * 处理一条互动事件。
     *
     * <b>判定顺序有讲究：先便宜的，后贵的。</b>
     * 前三步都是纯内存判断，第四步要跨两个服务拉快照。
     * 顺序错了就是白花两次网络调用。
     *
     * @return true = 处理成功（含"不该发消息"和"已发过"）；false 留给将来需要重投的场景
     */
    @Transactional
    public boolean onInteractionChanged(String rawPayload) {
        InteractionChange event;
        try {
            event = objectMapper.readValue(rawPayload, InteractionChange.class);
        } catch (Exception e) {
            // 反序列化不了，重投多少次都没用。记 ERROR 并返回成功，让它进死信队列，
            // 而不是无限重试堵住整个消费组。
            log.error("互动事件反序列化失败，丢弃 payload={}", rawPayload, e);
            return true;
        }

        // ① 收藏不发消息：它是私密行为，被收藏的人不该知道
        if (event.kind() == InteractionChange.Kind.FAVORITE) {
            return true;
        }
        // ② 取消不是新消息，是撤销
        if (event.change() == InteractionChange.Change.REMOVED) {
            return true;
        }
        Long actorId = parse(event.actorId());
        Long ownerId = parse(event.targetOwnerId());
        // ③ 自己赞自己
        if (actorId != null && actorId.equals(ownerId)) {
            return true;
        }
        if (ownerId == null) {
            // 载荷缺 targetOwnerId 说明生产端有 bug，不是暂时故障
            log.error("互动事件缺少 targetOwnerId，丢弃 eventId={}", event.eventId());
            return true;
        }

        // ④ 到这里才值得花两次跨服务调用
        Actor actor = snapshotService.actor(actorId);
        Target target = snapshotService.target(event.targetType().name(), parse(event.targetId()));
        if (target.ownerId() != null && !target.ownerId().equals(ownerId)) {
            // 目标作者与事件里的 ownerId 不一致：要么期间有数据变更，要么生产端算错了。
            // 以 content 的当前真相为准，但记一条 WARN 便于发现飘移。
            log.warn("事件 ownerId 与目标实际作者不一致 eventId={} event={} actual={}",
                    event.eventId(), ownerId, target.ownerId());
        }

        Message row = new Message();
        row.setUserId(ownerId);
        row.setType(Message.TYPE_LIKE);
        row.setSourceEventId(event.eventId());
        row.setActorId(actorId);
        row.setActorNickname(actor.nickname());
        row.setActorAvatar(actor.avatarUrl());
        row.setTargetType(Message.TARGET_POST.equals(event.targetType().name())
                ? Message.TARGET_POST : Message.TARGET_COMMENT);
        row.setTargetId(parse(event.targetId()));
        row.setTargetTitle(SnapshotService.trim(target.title(), 255));
        row.setExcerpt(trimExcerpt(target.excerpt()));
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));

        if (messageMapper.insertIgnore(row) == 0) {
            log.info("重复投递，已忽略 eventId={}", event.eventId());
            return true;
        }
        log.info("消息已落库 userId={} type=LIKE actor={} eventId={}",
                ownerId, actor.nickname(), event.eventId());
        return true;
    }

    /** 未读四类。没出现过的类型补 0，让前端不用判 undefined */
    public Unread unread(Long userId) {
        List<MessageMapper.TypeCount> rows = messageMapper.countUnreadByType(userId);
        long like = 0;
        long comment = 0;
        long mention = 0;
        long system = 0;
        for (MessageMapper.TypeCount r : rows) {
            long n = r.cnt();
            switch (r.type()) {
                case Message.TYPE_LIKE -> like = n;
                case Message.TYPE_COMMENT -> comment = n;
                case Message.TYPE_MENTION -> mention = n;
                case Message.TYPE_SYSTEM -> system = n;
                default -> {
                    // 未知类型不参与统计，但不能抛：多一个类型不该让整个接口挂掉
                }
            }
        }
        return new Unread(like, comment, mention, system, like + comment + mention + system);
    }

    /**
     * 全部已读。
     *
     * <b>没有竞态</b>：并发到达的新消息要么落在 UPDATE 之前（一起被标已读，一致），
     * 要么落在之后（保持未读，一致）。Redis 计数器方案的 SET 0 会把它抹掉。
     */
    @Transactional
    public int markAllRead(Long userId) {
        return messageMapper.markAllRead(userId, LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
    }

    /** 四类未读 + 总数 */
    public record Unread(long like, long comment, long mention, long system, long total) {
    }

    private static String trimExcerpt(String text) {
        return SnapshotService.trim(text, EXCERPT_MAX);
    }

    private static Long parse(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            // 载荷里的 id 是字符串（见 InteractionChange 的注释）。解析不了就是坏数据，
            // 重投没用，当缺失处理。
            return null;
        }
    }
}
