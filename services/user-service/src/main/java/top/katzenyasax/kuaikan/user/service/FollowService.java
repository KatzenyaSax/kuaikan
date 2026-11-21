package top.katzenyasax.kuaikan.user.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.UserErrorCode;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.mq.UserFollowed;
import top.katzenyasax.kuaikan.common.outbox.OutboxEvent;
import top.katzenyasax.kuaikan.common.outbox.OutboxMapper;
import top.katzenyasax.kuaikan.user.config.FollowProperties;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.domain.UserFollow;
import top.katzenyasax.kuaikan.user.mapper.UserFollowMapper;
import top.katzenyasax.kuaikan.user.mapper.UserFollowMapper.FollowRow;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.FollowStateView;
import top.katzenyasax.kuaikan.user.web.dto.FollowUserView;
import top.katzenyasax.kuaikan.user.web.dto.UserProfileView;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 关注关系（P5.5.1）。写路径全部幂等，计数一律 COUNT(*)。
 *
 * <h2>写路径的语义是「设为关注 / 设为未关注」，不是「翻转」</h2>
 *
 * 与点赞一致（见 InteractionService）：重复 POST 因为 INSERT IGNORE 返回 0
 * 而**不产生第二个事件**，重复 DELETE 因为删到 0 行而不发事件。
 * 做成翻转就意味着"先查再写"，那是竞态，而且用户双击会变成一关一注。
 *
 * <h2>事件与事实在同一个本地事务</h2>
 *
 * 只有真的插进去（affectedRows == 1）才写 t_outbox；发 MQ 由 OutboxRelay 轮询负责。
 * 事务提交 = 事件一定被记住。
 */
@Service
public class FollowService {

    private static final Logger log = LoggerFactory.getLogger(FollowService.class);

    /** 游标标记：两个列表必须不同，否则拿错列表的游标会被静默解释成错误结果 */
    private static final String SORT_FOLLOWING = "follow-following";
    private static final String SORT_FOLLOWERS = "follow-followers";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    /** 批量状态查询的单次上限，与 GET /users?ids= 保持一致 */
    private static final int MAX_STATE_IDS = 50;

    private final UserMapper userMapper;
    private final UserFollowMapper followMapper;
    private final OutboxMapper outboxMapper;
    private final ObjectMapper objectMapper;
    private final FollowProperties followProperties;

    public FollowService(UserMapper userMapper,
                         UserFollowMapper followMapper,
                         OutboxMapper outboxMapper,
                         ObjectMapper objectMapper,
                         FollowProperties followProperties) {
        this.userMapper = userMapper;
        this.followMapper = followMapper;
        this.outboxMapper = outboxMapper;
        this.objectMapper = objectMapper;
        this.followProperties = followProperties;
    }

    // ------------------------------------------------------------ 写路径

    /**
     * 关注。
     *
     * 检查顺序（每一步都比上一步贵，所以别调换）：
     *   1. 不能关注自己（纯内存，40210）
     *   2. 目标用户存在（一次主键查，40209）
     *   3. 已经关注了？（幂等直接返回，一次唯一键查询）
     *   4. 关注数上限（一次 COUNT(*)，40211）
     *   5. INSERT IGNORE，只有 affectedRows == 1 才写 outbox
     *
     * <b>先判"已关注"再判上限</b>：已关注的人重复点关注不该被 40211 挡住 ——
     * 它不是新增关系，也就不受上限约束。
     */
    @Transactional
    public void follow(Long followerId, Long followeeId) {
        if (followerId.equals(followeeId)) {
            throw new BizException(UserErrorCode.CANNOT_FOLLOW_SELF);
        }
        requireUser(followeeId);

        if (followMapper.exists(followerId, followeeId) > 0) {
            // 幂等：不重复写事件。这也是「取关再关注 24h 内只收 1 条 FOLLOW 消息」的第一层
            log.info("重复关注，已忽略 follower={} followee={}", followerId, followeeId);
            return;
        }

        int max = followProperties.getMaxFollowing();
        if (followMapper.countFollowing(followerId) >= max) {
            log.info("关注数已达上限 follower={} max={}", followerId, max);
            throw new BizException(UserErrorCode.FOLLOW_LIMIT_EXCEEDED);
        }

        UserFollow row = new UserFollow();
        row.setFollowerId(followerId);
        row.setFolloweeId(followeeId);
        row.setCreatedAt(LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS));
        if (followMapper.insertIgnore(row) == 1) {
            // 快照：user-service 自己就是 t_user 的所有者，同事务内零成本拿到
            User follower = userMapper.selectById(followerId);
            enqueueUserFollowed(follower, followerId, followeeId);
            log.info("新增关注 follower={} followee={}", followerId, followeeId);
        }
        // affectedRows == 0：并发下另一个请求刚刚插入，同样按幂等处理
    }

    /** 取关。幂等：本来就没关注则不发事件 */
    @Transactional
    public void unfollow(Long followerId, Long followeeId) {
        requireUser(followeeId);
        if (followMapper.deleteByPair(followerId, followeeId) == 1) {
            log.info("取消关注 follower={} followee={}", followerId, followeeId);
        }
        // 删除 0 行 = 本来就没关注。不发 UserFollowed（也没有「取关事件」这种东西）
    }

    // ------------------------------------------------------------ 读路径

    /** 用户主页资料。游客可读，不含任何当前用户私有字段 */
    public UserProfileView profile(Long userId) {
        User user = requireUser(userId);
        return new UserProfileView(user.getId(), user.getNickname(), user.getAvatarUrl(),
                followMapper.countFollowing(userId), followMapper.countFollowers(userId));
    }

    /** ta 关注的人。游客可读 */
    public PageResult<FollowUserView> following(Long userId, String cursor, Integer limit) {
        requireUser(userId);
        return page(SORT_FOLLOWING, normalizeLimit(limit), cursor,
                (at, id, size) -> followMapper.pageFollowing(userId, at, id, size));
    }

    /** 关注 ta 的人。游客可读 */
    public PageResult<FollowUserView> followers(Long userId, String cursor, Integer limit) {
        requireUser(userId);
        return page(SORT_FOLLOWERS, normalizeLimit(limit), cursor,
                (at, id, size) -> followMapper.pageFollowers(userId, at, id, size));
    }

    /**
     * 我关注的全部人（上限取 kuaikan.follow.max-following，默认 200）。
     *
     * 给 {@code /following} 页用：左栏列表与右栏「全部关注」拉帖一次拿全，
     * 避免反复翻页。单人上限 200 正是为了让这条能一次取完。
     */
    public List<FollowUserView> myFollowing(Long followerId) {
        int limit = followProperties.getMaxFollowing();
        return followMapper.pageFollowing(followerId, null, null, limit).stream()
                .map(FollowUserView::of)
                .toList();
    }

    /**
     * 我 vs 这批用户的关系。
     *
     * 返回 Map 的 key 是**字符串**：雪花 id 以数字形式下发会在 JS 里丢精度，
     * 而 Map 的 key 天生是字符串，正好与全站的"id 一律字符串"对齐。
     *
     * 全程只查两次（我关注了谁 / 谁关注了我），而不是每个目标两次。
     */
    public Map<String, FollowStateView> states(Long currentUserId, String rawUserIds) {
        List<Long> ids = parseIds(rawUserIds);
        if (ids.isEmpty()) {
            return Map.of();
        }
        Set<Long> following = new LinkedHashSet<>(
                followMapper.selectFollowingAmong(currentUserId, ids));
        Set<Long> followedBy = new LinkedHashSet<>(
                followMapper.selectFollowerAmong(currentUserId, ids));

        Map<String, FollowStateView> out = new LinkedHashMap<>();
        for (Long id : ids) {
            out.put(String.valueOf(id),
                    new FollowStateView(following.contains(id), followedBy.contains(id)));
        }
        return out;
    }

    // ------------------------------------------------------------ 内部

    /** 游标分页的共同部分：解码 → 多取一条 → 组装 */
    private PageResult<FollowUserView> page(String sort, int size, String cursor, PageQuery query) {
        CursorCodec.Cursor c = CursorCodec.decode(cursor, sort);
        LocalDateTime at = c == null ? null
                : LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()),
                        ZoneId.systemDefault());
        Long cursorId = c == null ? null : c.id();

        // 多取一条用来判断有没有下一页，省掉一次 count
        List<FollowRow> rows = query.fetch(at, cursorId, size + 1);

        List<FollowUserView> items = new ArrayList<>();
        for (int i = 0; i < rows.size() && i < size; i++) {
            items.add(FollowUserView.of(rows.get(i)));
        }
        String next = null;
        if (rows.size() > size) {
            FollowRow last = rows.get(size - 1);
            next = CursorCodec.encode(sort,
                    last.followedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
                    last.followId());
        }
        return PageResult.of(items, next);
    }

    @FunctionalInterface
    private interface PageQuery {
        List<FollowRow> fetch(LocalDateTime cursorAt, Long cursorId, int limit);
    }

    /**
     * 目标用户必须存在。
     *
     * 已注销（deleted_at 非空）一律按不存在处理：对外不区分
     * "从没存在过" 与 "已注销"（同一纪律见 content 的帖子详情）。
     */
    private User requireUser(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(UserErrorCode.USER_NOT_FOUND);
        }
        return user;
    }

    /**
     * 逗号分隔的 id 列表：去重、保序、最多 50 个，非法 id 一律 40010。
     *
     * 空字符串返回空列表（调用方返回空 Map），不是错误 ——
     * 前端在没有目标时不该被迫特殊处理。
     */
    private static List<Long> parseIds(String raw) {
        Set<Long> unique = new LinkedHashSet<>();
        if (raw == null || raw.isBlank()) {
            return new ArrayList<>(unique);
        }
        for (String part : raw.split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            long id;
            try {
                id = Long.parseLong(trimmed);
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "userIds 必须是逗号分隔的数字");
            }
            if (id <= 0) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "userIds 必须是逗号分隔的数字");
            }
            unique.add(id);
            if (unique.size() > MAX_STATE_IDS) {
                throw new BizException(CommonErrorCode.PARAM_INVALID,
                        "单次最多查询 " + MAX_STATE_IDS + " 个用户");
            }
        }
        return new ArrayList<>(unique);
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        return Math.max(1, Math.min(limit, MAX_LIMIT));
    }

    /**
     * 写一条 {@link UserFollowed} 到 outbox。
     *
     * 与关注关系在同一个本地事务里 —— 事务提交 = 事件一定被记住。
     * 序列化失败直接抛，让整个事务回滚：宁可关注失败，也不要"关系建了但消息没了"。
     *
     * 昵称头像在这里固化成快照：消息记的是「关注那一刻」的对方，符合不变量 9。
     */
    private void enqueueUserFollowed(User follower, Long followerId, Long followeeId) {
        UserFollowed event = new UserFollowed(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                String.valueOf(followerId),
                String.valueOf(followeeId),
                follower == null ? null : follower.getNickname(),
                follower == null ? null : follower.getAvatarUrl());

        OutboxEvent row = new OutboxEvent();
        row.setEventId(event.eventId());
        row.setTopic(Topics.USER_FOLLOWED);
        try {
            row.setPayload(objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            throw new IllegalStateException("事件序列化失败", e);
        }
        row.setStatus(OutboxEvent.STATUS_PENDING);
        row.setRetryCount(0);
        row.setNextRetryAt(LocalDateTime.now());
        outboxMapper.insert(row);
    }
}
