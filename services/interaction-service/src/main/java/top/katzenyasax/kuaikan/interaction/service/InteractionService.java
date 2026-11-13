package top.katzenyasax.kuaikan.interaction.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.mq.InteractionChange;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.interaction.domain.Interaction;
import top.katzenyasax.kuaikan.interaction.domain.OutboxEvent;
import top.katzenyasax.kuaikan.interaction.feign.ContentTargetClient;
import top.katzenyasax.kuaikan.interaction.feign.TargetView;
import top.katzenyasax.kuaikan.interaction.mapper.InteractionMapper;
import top.katzenyasax.kuaikan.interaction.mapper.OutboxMapper;
import top.katzenyasax.kuaikan.interaction.web.dto.InteractionState;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetCount;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 点赞 / 收藏。
 *
 * <b>接口语义是"设为某状态"，不是"翻转"</b>：
 *   {@code POST /likes}    = 设为已赞
 *   {@code DELETE /likes}  = 设为未赞
 *
 * 这个选择决定了一切：重复 POST 是幂等的，因为 INSERT IGNORE 返回 0，
 * 于是**不产生第二个事件**；DELETE 本来就没有的行也是幂等的，不发事件。
 * 如果做成"翻转"，服务端就得先查再写，那是竞态，而且用户双击会变成一赞一取消。
 *
 * 写路径只做两件事：写事实 + 写 outbox，**同一个本地事务**。
 * 发 MQ 由 OutboxRelay 轮询负责 —— 事务提交 = 事件一定被记住。
 */
@Service
public class InteractionService {

    private static final Logger log = LoggerFactory.getLogger(InteractionService.class);

    private final InteractionMapper interactionMapper;
    private final OutboxMapper outboxMapper;
    private final ContentTargetClient targetClient;
    private final ObjectMapper objectMapper;

    public InteractionService(InteractionMapper interactionMapper,
                              OutboxMapper outboxMapper,
                              ContentTargetClient targetClient,
                              ObjectMapper objectMapper) {
        this.interactionMapper = interactionMapper;
        this.outboxMapper = outboxMapper;
        this.targetClient = targetClient;
        this.objectMapper = objectMapper;
    }

    /** 设为已赞 / 已收藏。幂等：本来就是则不发事件 */
    @Transactional
    public void add(Long userId, int kind, int targetType, Long targetId) {
        // 先做本地规则校验，再发跨服务调用 —— 参数本身就错的时候没必要问下游
        if (kind == Interaction.KIND_FAVORITE && targetType != Interaction.TARGET_POST) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "只能收藏帖子");
        }
        TargetView target = requireTarget(targetType, targetId);

        Interaction row = new Interaction();
        row.setUserId(userId);
        row.setKind(kind);
        row.setTargetType(targetType);
        row.setTargetId(targetId);
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));

        if (interactionMapper.insertIgnore(row) == 1) {
            enqueue(InteractionChange.Change.ADDED, kind, targetType, targetId, userId, target.ownerId());
            log.info("新增互动 kind={} target={}:{} userId={}", kind, targetType, targetId, userId);
        }
        // affectedRows == 0 表示本来就存在：幂等返回，且**不产生事件**
    }

    /** 设为未赞 / 未收藏。幂等：本来就没有则不发事件 */
    @Transactional
    public void remove(Long userId, int kind, int targetType, Long targetId) {
        TargetView target = requireTarget(targetType, targetId);
        if (interactionMapper.deleteByUnique(userId, kind, targetType, targetId) == 1) {
            enqueue(InteractionChange.Change.REMOVED, kind, targetType, targetId, userId, target.ownerId());
            log.info("取消互动 kind={} target={}:{} userId={}", kind, targetType, targetId, userId);
        }
    }

    /** (目标类型, 目标 id) 的组合，仅本类内部使用 */
    private record TargetKey(int type, long id) {
        String token() {
            return type + ":" + id;
        }
    }

    /**
     * 批量查"我对这些目标是什么状态"。
     *
     * 一屏帖子 + 评论可能有几十个目标。**全程只查两次**（like 一次、favorite 一次），
     * 而不是每个目标查两次 —— 后者在 50 个目标时就是 100 次往返。
     * 唯一键 {@code (user_id, kind, target_type, target_id)} 正好覆盖这个查询。
     */
    public List<InteractionState> states(Long userId, List<String> targets) {
        if (targets.isEmpty()) {
            return List.of();
        }
        final int max = 200;
        if (targets.size() > max) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "单次最多查询 " + max + " 个目标");
        }

        // LinkedHashSet：去重且保序，返回顺序与请求一致
        Set<TargetKey> keys = new LinkedHashSet<>();
        for (String raw : targets) {
            String[] parts = raw.split(":");
            if (parts.length != 2) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "targets 格式应为 post:1,comment:2");
            }
            int type = switch (parts[0]) {
                case "post" -> Interaction.TARGET_POST;
                case "comment" -> Interaction.TARGET_COMMENT;
                default -> throw new BizException(CommonErrorCode.PARAM_INVALID, "未知的目标类型");
            };
            long id;
            try {
                id = Long.parseLong(parts[1]);
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "目标 id 必须是数字");
            }
            keys.add(new TargetKey(type, id));
        }

        Set<String> liked = queryTokens(userId, Interaction.KIND_LIKE, keys);
        Set<String> favorited = queryTokens(userId, Interaction.KIND_FAVORITE, keys);

        List<InteractionState> out = new ArrayList<>(keys.size());
        for (TargetKey k : keys) {
            out.add(new InteractionState(
                    k.type() == Interaction.TARGET_POST ? "post" : "comment",
                    k.id(),
                    liked.contains(k.token()),
                    favorited.contains(k.token())));
        }
        return out;
    }

    /**
     * 这些目标的**事实计数**。给 content 的对账任务用。
     *
     * **必须对没有互动的目标也返回 0**：只返回有互动的目标（GROUP BY 的自然行为）
     * 会让"计数应该归零"的目标永远修不回来——那正是对账最需要修的情况
     * （点赞全取消后计数卡在旧值）。
     */
    public List<TargetCount> counts(List<String> targets) {
        if (targets.isEmpty()) {
            return List.of();
        }
        // 200 而不是更大：这批 id 走的是 GET 的 query string，
        // 一个雪花 id 的 token 约 24 字节（`post:2120789385803038721`），
        // 500 个约 12KB —— **超过 Tomcat 默认 8KB 的 header 上限，直接 400**。
        // 实测 500 → 400、200 → 200。要放大必须先改成 POST + body。
        if (targets.size() > 200) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "单次最多查询 200 个目标");
        }

        Map<String, long[]> acc = new LinkedHashMap<>(); // token -> [like, favorite]
        Set<Long> ids = new LinkedHashSet<>();
        for (String raw : targets) {
            String[] parts = raw.split(":");
            if (parts.length != 2) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "targets 格式应为 post:1,comment:2");
            }
            int type = switch (parts[0]) {
                case "post" -> Interaction.TARGET_POST;
                case "comment" -> Interaction.TARGET_COMMENT;
                default -> throw new BizException(CommonErrorCode.PARAM_INVALID, "未知的目标类型");
            };
            long id;
            try {
                id = Long.parseLong(parts[1]);
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "目标 id 必须是数字");
            }
            // 先给每个目标放一个 0，保证"没有互动"也能被显式回答
            acc.putIfAbsent(type + ":" + id, new long[]{0, 0});
            ids.add(id);
        }

        if (!ids.isEmpty()) {
            List<Interaction> rows = interactionMapper.selectList(
                    new LambdaQueryWrapper<Interaction>().in(Interaction::getTargetId, ids));
            for (Interaction row : rows) {
                long[] slot = acc.get(row.getTargetType() + ":" + row.getTargetId());
                if (slot == null) {
                    continue;
                }
                if (row.getKind() == Interaction.KIND_LIKE) {
                    slot[0]++;
                } else if (row.getKind() == Interaction.KIND_FAVORITE) {
                    slot[1]++;
                }
            }
        }

        List<TargetCount> out = new ArrayList<>(acc.size());
        acc.forEach((token, v) -> {
            String[] parts = token.split(":");
            out.add(new TargetCount(parts[0].equals("1") ? "post" : "comment",
                    Long.parseLong(parts[1]), v[0], v[1]));
        });
        return out;
    }

    /** 一次查出该用户对这些目标里哪些有某种互动 */
    private Set<String> queryTokens(Long userId, int kind, Set<TargetKey> keys) {
        Set<Long> ids = new LinkedHashSet<>();
        for (TargetKey k : keys) {
            ids.add(k.id());
        }
        List<Interaction> rows = interactionMapper.selectList(
                new LambdaQueryWrapper<Interaction>()
                        .eq(Interaction::getUserId, userId)
                        .eq(Interaction::getKind, kind)
                        .in(Interaction::getTargetId, ids));
        Set<String> tokens = new LinkedHashSet<>();
        for (Interaction row : rows) {
            tokens.add(row.getTargetType() + ":" + row.getTargetId());
        }
        return tokens;
    }

    // ---------------------------------------------------------------- 内部

    /** 目标必须存在。失败一律 50300（沿用 P2.3 先例：这是必要的依赖，不是可选的增强） */
    private TargetView requireTarget(int targetType, Long targetId) {
        String type = targetType == Interaction.TARGET_POST ? "post" : "comment";
        Result<TargetView> result;
        try {
            result = targetClient.target(type, targetId);
        } catch (Exception e) {
            log.error("目标校验失败 type={} id={}", type, targetId, e);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        if (result == null || result.data() == null) {
            log.error("目标校验返回空 body type={} id={}", type, targetId);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        if (!result.data().exists()) {
            throw new BizException(targetType == Interaction.TARGET_POST
                    ? top.katzenyasax.kuaikan.common.error.ContentErrorCode.POST_NOT_FOUND
                    : top.katzenyasax.kuaikan.common.error.ContentErrorCode.COMMENT_NOT_FOUND);
        }
        return result.data();
    }

    /**
     * 写 outbox。与事实写入在同一个事务里 —— 这是整个 outbox 模式的意义所在：
     * 事务提交 = 事件一定被记住，投递可以慢慢来、失败可以重试。
     */
    private void enqueue(InteractionChange.Change change, int kind, int targetType,
                         Long targetId, Long actorId, String ownerId) {
        InteractionChange event = new InteractionChange(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                change,
                kind == Interaction.KIND_LIKE ? InteractionChange.Kind.LIKE : InteractionChange.Kind.FAVORITE,
                String.valueOf(actorId),
                targetType == Interaction.TARGET_POST
                        ? InteractionChange.TargetType.POST : InteractionChange.TargetType.COMMENT,
                String.valueOf(targetId),
                ownerId);

        OutboxEvent row = new OutboxEvent();
        row.setEventId(event.eventId());
        row.setTopic(Topics.INTERACTION_CHANGED);
        try {
            row.setPayload(objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            // 序列化失败说明契约本身有问题，不能静默吞掉：整个事务回滚
            throw new IllegalStateException("事件序列化失败", e);
        }
        row.setStatus(OutboxEvent.STATUS_PENDING);
        row.setRetryCount(0);
        row.setNextRetryAt(LocalDateTime.now());
        outboxMapper.insert(row);
    }
}
