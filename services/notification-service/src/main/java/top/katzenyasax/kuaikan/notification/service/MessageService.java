package top.katzenyasax.kuaikan.notification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import top.katzenyasax.kuaikan.common.mq.CommentCreated;
import top.katzenyasax.kuaikan.common.mq.InteractionChange;
import top.katzenyasax.kuaikan.common.mq.UserBanned;
import top.katzenyasax.kuaikan.common.mq.UserFollowed;
import top.katzenyasax.kuaikan.notification.domain.Message;
import top.katzenyasax.kuaikan.notification.mapper.MessageMapper;
import top.katzenyasax.kuaikan.notification.service.SnapshotService.Actor;
import top.katzenyasax.kuaikan.notification.service.SnapshotService.Target;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
    private final SseService sseService;

    /**
     * FOLLOW 的 24h 同人冷却窗口（P5.5.1）。默认 PT24H，可被 Nacos 覆盖
     * （验收要测"取关再关注 24h 内只收 1 条"，测试窗口得能调小）。
     */
    private final Duration followCooldown;

    public MessageService(MessageMapper messageMapper,
                          SnapshotService snapshotService,
                          ObjectMapper objectMapper,
                          SseService sseService,
                          @Value("${kuaikan.notification.follow-cooldown:PT24H}") Duration followCooldown) {
        this.messageMapper = messageMapper;
        this.snapshotService = snapshotService;
        this.objectMapper = objectMapper;
        this.sseService = sseService;
        this.followCooldown = followCooldown;
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
        // 点赞的是评论时，直接滚到那条评论；点赞帖子时没有锚点。
        // 被赞的评论本身可能是回复，但 TargetView 没返回它的 root —— 那种情况
        // 前端退化为停在帖子页（点赞回复的消息本来就少见）
        fillNavigation(row, target.postId(), target.communityId(),
                isCommentTarget(event) ? parse(event.targetId()) : null, null);
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));

        if (messageMapper.insertIgnore(row) == 0) {
            log.info("重复投递，已忽略 eventId={}", event.eventId());
            return true;
        }
        pushAfterCommit(ownerId, row);
        log.info("消息已落库 userId={} type=LIKE actor={} eventId={}",
                ownerId, actor.nickname(), event.eventId());
        return true;
    }

    /**
     * 事务**提交之后**才推送。
     *
     * 在事务里推的后果很具体：一旦回滚，红点已经亮了，而消息不存在。
     * 用户点进去看到空列表，只会以为是 bug。
     */
    private void pushAfterCommit(Long userId, Message row) {
        String messageId = String.valueOf(row.getId());
        String type = row.getType();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    sseService.pushNewMessage(userId, messageId, type);
                }
            });
        } else {
            // 没有事务上下文时直接推（正常路径不会走到这里）
            sseService.pushNewMessage(userId, messageId, type);
        }
    }

    /**
     * 处理一条评论事件。
     *
     * <h2>接收人怎么算</h2>
     *
     * <pre>
     *   帖子作者      → COMMENT（"评论了你的帖子"）
     *   被回复者      → COMMENT（"回复了你的评论"）
     *   正文里 @ 的人 → MENTION
     * </pre>
     *
     * <h2>合并：同一接收人只留一条，COMMENT 优先于 MENTION</h2>
     *
     * "回复了你，同时正文里 @ 了你"是**同一次动作**，产生两条消息只会让人困惑。
     * 这条规则让 {@code uk_user_event(user_id, source_event_id)} 两列就够用；
     * 若允许一人多条，唯一键就得加 type，约束也就弱了。
     *
     * <h2>自抑制</h2>
     *
     * 自己评论自己的帖子、自己 @ 自己，都不该给自己发消息。
     */
    @Transactional
    public boolean onCommentCreated(String rawPayload) {
        CommentCreated event;
        try {
            event = objectMapper.readValue(rawPayload, CommentCreated.class);
        } catch (Exception e) {
            log.error("评论事件反序列化失败，丢弃 payload={}", rawPayload, e);
            return true;
        }

        Long actorId = parse(event.actorId());
        Long postAuthorId = parse(event.postAuthorId());
        Long replyToUserId = parse(event.replyToUserId());

        // 接收人 -> 类型。LinkedHashMap 保序，让日志和插入顺序可预期。
        // 先放 COMMENT，再放 MENTION，putIfAbsent 保证 COMMENT 不会被覆盖。
        Map<Long, String> recipients = new LinkedHashMap<>();
        if (postAuthorId != null) {
            recipients.put(postAuthorId, Message.TYPE_COMMENT);
        }
        if (replyToUserId != null) {
            recipients.putIfAbsent(replyToUserId, Message.TYPE_COMMENT);
        }
        for (String mention : event.mentionUserIds() == null ? List.<String>of() : event.mentionUserIds()) {
            Long id = parse(mention);
            if (id != null) {
                recipients.putIfAbsent(id, Message.TYPE_MENTION);
            }
        }
        if (actorId != null) {
            recipients.remove(actorId);
        }
        if (recipients.isEmpty()) {
            return true;
        }

        // 快照：actor 只拉一次，target（被评论的帖子）也只拉一次
        Actor actor = snapshotService.actor(actorId);
        Target target = snapshotService.target("POST", parse(event.postId()));

        int created = 0;
        for (Map.Entry<Long, String> e : recipients.entrySet()) {
            Message row = new Message();
            row.setUserId(e.getKey());
            row.setType(e.getValue());
            row.setSourceEventId(event.eventId());
            row.setActorId(actorId);
            row.setActorNickname(actor.nickname());
            row.setActorAvatar(actor.avatarUrl());
            // 评论消息指向**帖子**：点进去要落到那条帖子的评论区，而不是某个孤立的评论
            row.setTargetType(Message.TARGET_POST);
            row.setTargetId(parse(event.postId()));
            row.setTargetTitle(SnapshotService.trim(target.title(), 255));
            row.setExcerpt(trimExcerpt(event.excerpt()));
            // 落在**新评论**上；rootCommentId 用来展开折叠的回复列表
            fillNavigation(row, parse(event.postId()), parse(event.communityId()),
                    parse(event.commentId()), parse(event.rootCommentId()));
            row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
            if (messageMapper.insertIgnore(row) == 1) {
                created += 1;
                pushAfterCommit(e.getKey(), row);
            }
        }
        log.info("评论消息已落库 postId={} actor={} 接收人={} 新建={}",
                event.postId(), actor.nickname(), recipients.size(), created);
        return true;
    }

    private static boolean isCommentTarget(InteractionChange event) {
        return event.targetType() == InteractionChange.TargetType.COMMENT;
    }

    /**
     * 填跳转需要的三个字段。
     *
     * <b>为什么在写入时固化，而不是读的时候现查</b>：
     * 读一页消息要拼 N 个 URL，现查就是 N 次跨服务调用，
     * 违反不变量 2（读路径禁止跨服务同步调用）。而消息本来就是快照。
     *
     * 社群名解析失败不能连累消息落库——名字拿不到就没有跳转，消息本身仍然有意义。
     */
    private void fillNavigation(Message row, Long postId, Long communityId,
                                Long commentId, Long rootCommentId) {
        row.setPostId(postId);
        row.setCommentId(commentId);
        row.setRootCommentId(rootCommentId);
        if (communityId == null) {
            return;
        }
        try {
            row.setCommunityName(snapshotService.communityName(communityId));
        } catch (Exception e) {
            log.warn("社群名解析失败，本条消息没有跳转 communityId={} 原因={}", communityId, e.toString());
        }
    }

    /** 未读五类。没出现过的类型补 0，让前端不用判 undefined */
    public Unread unread(Long userId) {
        List<MessageMapper.TypeCount> rows = messageMapper.countUnreadByType(userId);
        long like = 0;
        long comment = 0;
        long mention = 0;
        long follow = 0;
        long system = 0;
        for (MessageMapper.TypeCount r : rows) {
            long n = r.cnt();
            switch (r.type()) {
                case Message.TYPE_LIKE -> like = n;
                case Message.TYPE_COMMENT -> comment = n;
                case Message.TYPE_MENTION -> mention = n;
                case Message.TYPE_FOLLOW -> follow = n;
                case Message.TYPE_SYSTEM -> system = n;
                default -> {
                    // 未知类型不参与统计，但不能抛：多一个类型不该让整个接口挂掉
                }
            }
        }
        return new Unread(like, comment, mention, follow, system,
                like + comment + mention + follow + system);
    }

    /**
     * 处理一条关注事件 → FOLLOW 消息（P5.5.1）。
     *
     * <h2>三道门，全部在落库前</h2>
     *
     * 1. <b>自抑制</b>：{@code followerId == followeeId} 直接忽略。
     *    user-service 已经在写路径上挡了（40210），这里是纵深防御：
     *    消费者不该因为生产端的一个 bug 就给自己发一条"你关注了你自己"。
     * 2. <b>24h 同人冷却</b>：命中 {@code (user_id, type='FOLLOW', actor_id, created_at > now - cooldown)}
     *    就直接跳过落库与 SSE 并**正常 ACK**。这不是失败——
     *    否则重投会变成无限重试，而且用户永远只会看到满屏的同一个人。
     * 3. <b>幂等</b>：{@code uk_user_event} 挡住 MQ 重投。
     *
     * <h2>快照取自事件载荷，不回查 user-service</h2>
     *
     * {@code followerNickname / followerAvatar} 由 user-service 在写 outbox 的同一事务里固化，
     * 所以这里不需要一次跨服务调用（见 UserFollowed 的注释）。
     */
    @Transactional
    public boolean onUserFollowed(String rawPayload) {
        UserFollowed event;
        try {
            event = objectMapper.readValue(rawPayload, UserFollowed.class);
        } catch (Exception e) {
            log.error("关注事件反序列化失败，丢弃 payload={}", rawPayload, e);
            return true;
        }

        Long followerId = parse(event.followerId());
        Long followeeId = parse(event.followeeId());
        if (followerId == null || followeeId == null) {
            // 载荷缺 id 是生产端 bug，重投没用
            log.error("关注事件缺少 id，丢弃 eventId={}", event.eventId());
            return true;
        }
        // ① 自抑制
        if (followerId.equals(followeeId)) {
            return true;
        }

        LocalDateTime now = LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS);
        // ② 24h 冷却：命中即跳过落库与推流，但**正常 ACK**
        if (messageMapper.existsRecentFollow(followeeId, followerId, now.minus(followCooldown)) != null) {
            log.info("关注消息在冷却窗口内，已跳过 userId={} actor={} cooldown={}",
                    followeeId, followerId, followCooldown);
            return true;
        }

        Message row = new Message();
        row.setUserId(followeeId);
        row.setType(Message.TYPE_FOLLOW);
        row.setSourceEventId(event.eventId());
        row.setActorId(followerId);
        row.setActorNickname(clamp(event.followerNickname(), 64));
        row.setActorAvatar(clamp(event.followerAvatar(), 512));
        // 目标是「人」，跳转直接用 actorId → /u/{actorId}。
        // 没有 postId / commentId / communityName：关注消息不指向内容
        row.setTargetType(Message.TARGET_USER);
        row.setTargetId(followerId);
        row.setCreatedAt(now);

        // ③ 幂等：同一事件重投不会产生第二条
        if (messageMapper.insertIgnore(row) == 0) {
            log.info("重复投递，已忽略 eventId={}", event.eventId());
            return true;
        }
        pushAfterCommit(followeeId, row);
        log.info("关注消息已落库 userId={} actor={} eventId={}",
                followeeId, event.followerNickname(), event.eventId());
        return true;
    }

    /**
     * 处理一条封禁事件 → SYSTEM 消息。
     *
     * <b>接收人就是被封的人，actor 为空</b>：这不是"某人对你做了什么"，
     * 是平台对用户做的事。前端的文案分支按 type 走，不需要 actor。
     *
     * <b>一个反直觉的后果</b>：封禁同时会踢下线并拒绝登录，
     * 所以用户在被封期间看不到这条消息。它实际上是**解封后可读的审计记录**。
     * 这是刻意的——把封禁原因写成用户可见的记录，比只留在运维日志里更负责任。
     */
    @Transactional
    public boolean onUserBanned(String rawPayload) {
        UserBanned event;
        try {
            event = objectMapper.readValue(rawPayload, UserBanned.class);
        } catch (Exception e) {
            log.error("封禁事件反序列化失败，丢弃 payload={}", rawPayload, e);
            return true;
        }
        Long userId = parse(event.userId());
        if (userId == null) {
            log.error("封禁事件缺少 userId，丢弃 eventId={}", event.eventId());
            return true;
        }

        Message row = new Message();
        row.setUserId(userId);
        row.setType(Message.TYPE_SYSTEM);
        row.setSourceEventId(event.eventId());
        row.setActorId(null);
        row.setExcerpt(SnapshotService.trim(event.reason(), EXCERPT_MAX));
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));

        if (messageMapper.insertIgnore(row) == 0) {
            log.info("重复投递，已忽略 eventId={}", event.eventId());
            return true;
        }
        pushAfterCommit(userId, row);
        log.info("系统消息已落库 userId={} reason={}", userId, event.reason());
        return true;
    }

    /**
     * 标记单条已读。点开一条消息时调用。
     *
     * <b>幂等</b>：已经读过、或者 id 不属于当前用户，都返回 0 而不是报错。
     * 点开消息是一个"顺手"的动作，不该因为它失败而挡住跳转。
     */
    @Transactional
    public int markRead(Long userId, Long messageId) {
        return messageMapper.markRead(userId, messageId,
                LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
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

    /**
     * 五类未读 + 总数。顺序与抽屉 Tab 一致（点赞 / 评论 / @ / 关注 / 系统）。
     *
     * 注意：{@code UnreadView} 为了向后兼容把 {@code follow} 追加在 {@code system} 之后，
     * 两份记录的字段顺序**故意不同**，别按位置互传。
     */
    public record Unread(long like, long comment, long mention, long follow, long system, long total) {
    }

    private static String trimExcerpt(String text) {
        return SnapshotService.trim(text, EXCERPT_MAX);
    }

    /**
     * 硬截断到列宽。
     *
     * 不能用 {@link SnapshotService#trim}：它会补一个省略号，
     * 于是 64 字的昵称变成 65 字，VARCHAR(64) 在严格模式下直接插入失败。
     * 关注消息的昵称/头像来自事件载荷（对方可控的输入），必须自己把宽度钉死。
     */
    private static String clamp(String text, int max) {
        if (text == null) {
            return null;
        }
        String flat = text.strip();
        if (flat.isEmpty()) {
            return null;
        }
        return flat.length() <= max ? flat : flat.substring(0, max);
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
