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

    /** 登录/刷新后登记 access jti，并加入用户的 jti 集合（踢下线用） */
    public void registerAccess(Long userId, String jti, Duration ttl) {
        redis.opsForValue().set(AuthKeys.session(jti), String.valueOf(userId), ttl);
        String userJtiKey = AuthKeys.userJtiSet(userId);
        redis.opsForSet().add(userJtiKey, jti);
        // 集合存活时间和 refresh 一致：access 早已过期，但集合留着供 kick 使用
        redis.expire(userJtiKey, TokenService.REFRESH_TTL);
    }

    public void revokeAccess(String jti) {
        redis.delete(AuthKeys.session(jti));
    }

    public boolean isAccessActive(String jti) {
        Boolean exists = redis.hasKey(AuthKeys.session(jti));
        return Boolean.TRUE.equals(exists);
    }

    /** 踢下线：删除该用户全部 access 白名单 */
    public long revokeAllAccess(Long userId) {
        String key = AuthKeys.userJtiSet(userId);
        var members = redis.opsForSet().members(key);
        if (members == null || members.isEmpty()) {
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

    public long jtiSetSize(Long userId) {
        Long size = redis.opsForSet().size(AuthKeys.userJtiSet(userId));
        return size == null ? 0 : size;
    }

    public Long ttlOf(String jti) {
        return redis.getExpire(AuthKeys.session(jti), TimeUnit.SECONDS);
    }

    static void warnReplay(String familyId, String jti) {
        log.warn("检测到 refresh 重放，吊销整族 familyId={} jti={}", familyId, jti);
    }
}
