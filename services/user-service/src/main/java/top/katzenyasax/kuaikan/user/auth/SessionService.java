package top.katzenyasax.kuaikan.user.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.user.domain.RefreshToken;
import top.katzenyasax.kuaikan.user.mapper.RefreshTokenMapper;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 会话：access 白名单（Redis）+ refresh 家族（MySQL）。
 *
 * 为什么 access 白名单在 Redis：它是**每请求热路径**，且"立刻失效"依赖它（P1.3 网关查它）。
 * 为什么 refresh 在 MySQL：见 docs/design/p1-storage.md —— 要能分页、能审计、低频。
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    /** 重放检测的宽限期：多标签页同时刷新不算攻击 */
    private static final Duration REPLAY_GRACE = Duration.ofSeconds(30);

    private final StringRedisTemplate redis;
    private final RefreshTokenMapper refreshTokenMapper;

    public SessionService(StringRedisTemplate redis, RefreshTokenMapper refreshTokenMapper) {
        this.redis = redis;
        this.refreshTokenMapper = refreshTokenMapper;
    }

    // ---------------- access 白名单 ----------------

    /**
     * 登录/刷新后登记 access jti。
     *
     * 同时维护两处：
     *   auth:session:{jti}      → 网关每请求查它（正向：知道 jti 问是否有效）
     *   auth:user:{id}:access   → 踢下线时批量找（反向：知道 userId 找他所有 jti）
     *
     * 集合成员按 score（过期时间戳）在每次写入时顺手清理，因此规模被限制在
     * "最近 2 小时内签发的 access 数量"，不会随用户长期活跃无限增长。
     */
    public void registerAccess(Long userId, String jti, Duration ttl) {
        redis.opsForValue().set(AuthKeys.session(jti), String.valueOf(userId), ttl);

        String zsetKey = AuthKeys.userAccessJtis(userId);
        double expireAt = System.currentTimeMillis() / 1000.0 + ttl.toSeconds();
        redis.opsForZSet().add(zsetKey, jti, expireAt);
        pruneExpiredJtis(zsetKey);
        // key 的 TTL 与 access 一致即可：成员不可能活过它，最坏情况是 key 自然消失
        redis.expire(zsetKey, ttl);
    }

    /** 只访问而不签发时（如登出）也要能清掉自己那一条 */
    public void revokeAccess(String jti) {
        String userId = redis.opsForValue().get(AuthKeys.session(jti));
        redis.delete(AuthKeys.session(jti));
        if (userId != null) {
            redis.opsForZSet().remove(AuthKeys.userAccessJtis(Long.valueOf(userId)), jti);
        }
    }

    /** 剔除 score 已过期的成员（access 已失效，留着只是占内存） */
    private void pruneExpiredJtis(String zsetKey) {
        redis.opsForZSet().removeRangeByScore(zsetKey, 0, System.currentTimeMillis() / 1000.0);
    }

    public boolean isAccessActive(String jti) {
        Boolean exists = redis.hasKey(AuthKeys.session(jti));
        return Boolean.TRUE.equals(exists);
    }

    /** 踢下线：删除该用户全部仍有效的 access 白名单 */
    public long revokeAllAccess(Long userId) {
        String key = AuthKeys.userAccessJtis(userId);
        // 先清掉已过期的成员，避免为死 jti 做无意义的 DEL
        pruneExpiredJtis(key);

        var members = redis.opsForZSet().range(key, 0, -1);
        if (members == null || members.isEmpty()) {
            redis.delete(key);
            return 0;
        }
        members.forEach(jti -> redis.delete(AuthKeys.session(jti)));
        redis.delete(key);
        return members.size();
    }

    // ---------------- refresh 家族 ----------------

    @Transactional
    public void saveRefresh(RefreshToken token) {
        refreshTokenMapper.insert(token);
    }

    public RefreshToken findByJti(String jti) {
        return refreshTokenMapper.selectOne(
                new LambdaQueryWrapper<RefreshToken>().eq(RefreshToken::getJti, jti));
    }

    /**
     * 判断一次 refresh 使用是"正常轮换"、"宽限期内的重复提交"，还是"重放攻击"。
     */
    public ReplayVerdict judge(RefreshToken token) {
        if (token.getRevokedAt() != null) {
            return ReplayVerdict.REVOKED;
        }
        if (token.getExpiresAt().isBefore(LocalDateTime.now())) {
            return ReplayVerdict.EXPIRED;
        }
        if (token.getConsumedAt() == null) {
            return ReplayVerdict.FIRST_USE;
        }
        Duration since = Duration.between(token.getConsumedAt(), LocalDateTime.now());
        return since.compareTo(REPLAY_GRACE) <= 0 ? ReplayVerdict.WITHIN_GRACE : ReplayVerdict.REPLAY;
    }

    public enum ReplayVerdict {
        FIRST_USE,
        WITHIN_GRACE,
        REPLAY,
        REVOKED,
        EXPIRED
    }

    /** 标记为已消费，并记录轮换去向（审计用）。首次消费时间不覆盖，避免宽限被无限延长 */
    public void markConsumed(RefreshToken token, String replacedByJti) {
        LocalDateTime now = LocalDateTime.now();
        refreshTokenMapper.update(null, new LambdaUpdateWrapper<RefreshToken>()
                .eq(RefreshToken::getId, token.getId())
                .set(RefreshToken::getReplacedByJti, replacedByJti)
                .set(RefreshToken::getLastUsedAt, now)
                .set(token.getConsumedAt() == null, RefreshToken::getConsumedAt, now));
    }

    /** 吊销整族：检测到重放时用，假定该族已泄漏 */
    public int revokeFamily(String familyId) {
        return refreshTokenMapper.update(null, new LambdaUpdateWrapper<RefreshToken>()
                .eq(RefreshToken::getFamilyId, familyId)
                .isNull(RefreshToken::getRevokedAt)
                .set(RefreshToken::getRevokedAt, LocalDateTime.now()));
    }

    public void revokeOne(String jti) {
        refreshTokenMapper.update(null, new LambdaUpdateWrapper<RefreshToken>()
                .eq(RefreshToken::getJti, jti)
                .isNull(RefreshToken::getRevokedAt)
                .set(RefreshToken::getRevokedAt, LocalDateTime.now()));
    }

    /** 该用户仍然有效的会话（每个家族一条），供 /auth/sessions 使用 */
    public List<RefreshToken> activeSessions(Long userId) {
        return refreshTokenMapper.selectList(new LambdaQueryWrapper<RefreshToken>()
                .eq(RefreshToken::getUserId, userId)
                .isNull(RefreshToken::getConsumedAt)
                .isNull(RefreshToken::getRevokedAt)
                .gt(RefreshToken::getExpiresAt, LocalDateTime.now())
                .orderByDesc(RefreshToken::getIssuedAt));
    }

    public static LocalDateTime toLocal(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneId.systemDefault());
    }

    /** 供清理任务使用（P1 暂不启用） */
    public int deleteExpiredBefore(LocalDateTime before) {
        return refreshTokenMapper.delete(new LambdaQueryWrapper<RefreshToken>()
                .lt(RefreshToken::getExpiresAt, before));
    }

    /** 该用户仍有效的 access token 数量（会先剔除过期成员） */
    public long activeAccessCount(Long userId) {
        String key = AuthKeys.userAccessJtis(userId);
        pruneExpiredJtis(key);
        Long size = redis.opsForZSet().zCard(key);
        return size == null ? 0 : size;
    }

    public Long ttlOf(String jti) {
        return redis.getExpire(AuthKeys.session(jti), TimeUnit.SECONDS);
    }

    static void warnReplay(String familyId, String jti) {
        log.warn("检测到 refresh 重放，吊销整族 familyId={} jti={}", familyId, jti);
    }
}
