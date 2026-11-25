package top.katzenyasax.kuaikan.ai.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.ai.web.dto.QuotaView;
import top.katzenyasax.kuaikan.common.error.AiErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * Redis 配额、单流并发锁、全站日 token 熔断与单帖摘要共享缓存。
 */
@Service
public class AiQuotaService {

    private static final DateTimeFormatter DAY_FMT = DateTimeFormatter.BASIC_ISO_DATE;
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final Duration LOCK_TTL = Duration.ofSeconds(120);
    private static final Duration DAY_KEY_TTL = Duration.ofHours(48);

    private static final DefaultRedisScript<Long> CONSUME_QUOTA_SCRIPT = new DefaultRedisScript<>(
            "local cur = tonumber(redis.call('GET', KEYS[1]) or '0') " +
            "local limit = tonumber(ARGV[1]) " +
            "if cur >= limit then return -1 end " +
            "local next = redis.call('INCR', KEYS[1]) " +
            "if next == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end " +
            "return limit - next",
            Long.class);

    private static final DefaultRedisScript<Long> RELEASE_LOCK_SCRIPT = new DefaultRedisScript<>(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then " +
            "return redis.call('DEL', KEYS[1]) else return 0 end",
            Long.class);

    private final StringRedisTemplate redis;
    private final AiProperties props;

    public AiQuotaService(StringRedisTemplate redis, AiProperties props) {
        this.redis = redis;
        this.props = props;
    }

    public String acquireStreamLock(Long userId) {
        String token = UUID.randomUUID().toString();
        Boolean ok = redis.opsForValue().setIfAbsent(lockKey(userId), token, LOCK_TTL);
        if (!Boolean.TRUE.equals(ok)) {
            throw new BizException(AiErrorCode.AI_STREAM_BUSY);
        }
        return token;
    }

    public void releaseStreamLock(Long userId, String token) {
        if (token == null) {
            return;
        }
        redis.execute(RELEASE_LOCK_SCRIPT, List.of(lockKey(userId)), token);
    }

    public QuotaView getQuota(Long userId) {
        int limit = props.getDailyQuota();
        String raw = redis.opsForValue().get(quotaKey(userId));
        int used = 0;
        if (raw != null && !raw.isBlank()) {
            try {
                used = Math.max(0, Integer.parseInt(raw.trim()));
            } catch (NumberFormatException ignored) {
                used = 0;
            }
        }
        int remaining = Math.max(0, limit - used);
        return new QuotaView(limit, used, remaining);
    }

    public int consumeQuota(Long userId) {
        Long remaining = redis.execute(
                CONSUME_QUOTA_SCRIPT,
                List.of(quotaKey(userId)),
                String.valueOf(props.getDailyQuota()),
                String.valueOf(DAY_KEY_TTL.toSeconds()));
        if (remaining == null || remaining < 0) {
            throw new BizException(AiErrorCode.AI_QUOTA_EXCEEDED);
        }
        return remaining.intValue();
    }

    public void assertWithinBudget() {
        String raw = redis.opsForValue().get(budgetKey());
        if (raw == null || raw.isBlank()) {
            return;
        }
        try {
            long used = Long.parseLong(raw.trim());
            if (used >= props.getDailyTokenBudget()) {
                throw new BizException(AiErrorCode.AI_UNAVAILABLE, "今日全站 AI 预算已达上限，请明日再试");
            }
        } catch (NumberFormatException ignored) {
            // ignore malformed value
        }
    }

    public void addBudgetTokens(long tokens) {
        if (tokens <= 0) {
            return;
        }
        Long after = redis.opsForValue().increment(budgetKey(), tokens);
        if (after != null && after == tokens) {
            redis.expire(budgetKey(), DAY_KEY_TTL);
        }
    }

    public String getCachedSummary(Long postId, long commentCount) {
        return redis.opsForValue().get(summaryKey(postId, commentCount));
    }

    public void putCachedSummary(Long postId, long commentCount, String json) {
        if (json == null || json.isBlank()) {
            return;
        }
        redis.opsForValue().set(
                summaryKey(postId, commentCount),
                json,
                Duration.ofHours(props.getSummaryCacheHours()));
    }

    private String today() {
        return LocalDate.now(ZONE).format(DAY_FMT);
    }

    private String quotaKey(Long userId) {
        return "ai:quota:" + today() + ":" + userId;
    }

    private String budgetKey() {
        return "ai:budget:" + today();
    }

    private String lockKey(Long userId) {
        return "ai:lock:stream:" + userId;
    }

    private String summaryKey(Long postId, long commentCount) {
        return "ai:summary:" + postId + ":" + commentCount;
    }
}
