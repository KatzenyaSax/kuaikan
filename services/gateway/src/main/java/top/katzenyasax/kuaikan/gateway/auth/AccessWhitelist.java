package top.katzenyasax.kuaikan.gateway.auth;

import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * access 白名单查询：auth:session:{jti} 是否存在。
 *
 * 这是"立刻失效"能力的全部来源。无状态 JWT 本身无法撤销，
 * 撤销能力来自这一次 Redis 查询。
 *
 * **不做本地缓存**：缓存 5 秒就等于让"立刻失效"退化成"5 秒内仍有效"，
 * 而即时失效正是 P1 存在的意义。50 并发下一次往返是亚毫秒开销。
 *
 * 必须用响应式客户端：阻塞式 Jedis/RedisTemplate 会占住 event loop，
 * 几十个并发就能把整个网关拖死，而症状是"功能正常、压测直接崩"。
 */
@Component
public class AccessWhitelist {

    private static final String KEY_PREFIX = "auth:session:";

    private final ReactiveStringRedisTemplate redis;

    public AccessWhitelist(ReactiveStringRedisTemplate redis) {
        this.redis = redis;
    }

    /** true = 该 jti 仍有效 */
    public Mono<Boolean> isActive(String jti) {
        return redis.hasKey(KEY_PREFIX + jti);
    }
}
