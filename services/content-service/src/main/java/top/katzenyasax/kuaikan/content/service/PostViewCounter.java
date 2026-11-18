package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;

import java.util.Set;

/**
 * 浏览量计数：Redis 缓冲 + 定期回写 MySQL。
 *
 * <h2>为什么不能直接 UPDATE t_post</h2>
 *
 * 1. **GET 会变成写操作** —— 语义被破坏，不能缓存，也不能重试
 * 2. **热点帖打爆写路径** —— 每看一次一次 UPDATE
 * 3. **与缓存根本不兼容** —— nginx 的 L0 与 Caffeine 的 L1 命中时，
 *    请求根本到不了服务，"每次请求 +1" 无从谈起
 *
 * <h2>为什么不精确是允许的</h2>
 *
 * 口径已经定死为"不要求精确"（P2 的 V1 迁移里就把它列为待定，P5 定成不精确）。
 * 所以：Redis 挂了丢一批计数、缓存命中少算、flush 期间并发丢失——
 * 全都接受。它只是热度公式里的一个 0.5 权重项。
 *
 * <h2>为什么用 SET 记录脏 id 而不是 SCAN</h2>
 *
 * `SCAN` 在生产 Redis 上是危险操作（尤其带 MATCH）。
 * 用一个 set 记录"哪些帖子有未回写的浏览"是 O(脏帖数) 的，
 * 而且天然去重——同一个帖子被看 100 次，set 里也只有一条。
 */
@Service
public class PostViewCounter {

    private static final Logger log = LoggerFactory.getLogger(PostViewCounter.class);

    /** 每帖一个计数器 */
    private static final String KEY_PREFIX = "view:post:";
    /** 有未回写计数的帖子集合 */
    private static final String DIRTY_SET = "view:dirty";

    /** 单轮最多处理多少个帖子，避免一次 flush 太久 */
    private static final int FLUSH_BATCH = 500;

    private final StringRedisTemplate redis;
    private final PostMapper postMapper;

    public PostViewCounter(StringRedisTemplate redis, PostMapper postMapper) {
        this.redis = redis;
        this.postMapper = postMapper;
    }

    /**
     * 记一次浏览。
     *
     * <b>失败只记 WARN 不抛</b>：浏览量涨不上去是遗憾，让帖子详情页 500 是事故。
     * 这是本项目里少数几个"显式降级"的位置之一。
     */
    public void recordView(Long postId) {
        if (postId == null) {
            return;
        }
        try {
            redis.opsForValue().increment(KEY_PREFIX + postId);
            redis.opsForSet().add(DIRTY_SET, String.valueOf(postId));
        } catch (DataAccessException e) {
            log.warn("浏览量计数失败（不影响浏览）postId={} 原因={}", postId, e.toString());
        }
    }

    /**
     * 把 Redis 里的增量回写到 MySQL，然后清掉计数器。
     *
     * <b>用 getAndDelete 而不是 GET 再 DEL</b>：两步之间到达的浏览会被丢掉。
     * getAndDelete 是原子的，代价只是"这批增量如果写库失败就真的没了"——
     * 与"不要求精确"一致。
     */
    @Scheduled(fixedDelayString = "${kuaikan.view.flush-interval:60s}")
    public void flush() {
        Set<String> dirty;
        try {
            dirty = redis.opsForSet().members(DIRTY_SET);
        } catch (DataAccessException e) {
            log.warn("浏览回写跳过：读不到脏集合 {}", e.toString());
            return;
        }
        if (dirty == null || dirty.isEmpty()) {
            return;
        }

        int done = 0;
        for (String raw : dirty) {
            if (done >= FLUSH_BATCH) {
                // 剩下的留到下一轮：不清它的 dirty 标记
                break;
            }
            Long postId;
            try {
                postId = Long.parseLong(raw);
            } catch (NumberFormatException e) {
                // 脏数据，从集合里摘掉，否则每轮都会卡在它上面
                redis.opsForSet().remove(DIRTY_SET, raw);
                continue;
            }

            String value;
            try {
                value = redis.opsForValue().getAndDelete(KEY_PREFIX + postId);
            } catch (DataAccessException e) {
                log.warn("浏览回写跳过 postId={} 原因={}", postId, e.toString());
                break;
            }
            // 计数为 0 或已被别的实例取走：只需把标记摘掉
            redis.opsForSet().remove(DIRTY_SET, raw);
            if (value == null) {
                continue;
            }
            try {
                postMapper.addViewCount(postId, Integer.parseInt(value));
                done += 1;
            } catch (Exception e) {
                // 写库失败：这一批增量就丢了（口径允许）。记 WARN 便于观察频率
                log.warn("浏览回写失败，丢弃 {} 次 postId={} 原因={}", value, postId, e.toString());
            }
        }
        if (done > 0) {
            log.debug("浏览回写完成 {} 个帖子", done);
        }
    }
}
