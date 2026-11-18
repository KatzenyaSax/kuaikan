package top.katzenyasax.kuaikan.rank.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.rank.web.dto.HotItem;
import top.katzenyasax.kuaikan.rank.web.dto.HotPage;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 读榜单。
 *
 * <h2>读路径零跨服务调用</h2>
 *
 * 重建时已经把标题、社群名写进 meta Hash 了，所以读的时候只要 Redis 三次往返：
 * 取版本号 → ZREVRANGE 分数 → HMGET 元信息。**一次 HTTP 都不发。**
 *
 * 如果读的时候再批量查 content 拿标题，就是读路径跨服务同步调用（违反不变量 2），
 * 而且一次 50 条。标题是快照——榜单只活 5 分钟，标题改了下次重建就跟上。
 */
@Service
public class RankQueryService {

    private static final Logger log = LoggerFactory.getLogger(RankQueryService.class);
    private static final String PREFIX = "rank:hot:";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RankQueryService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    static String currentKey(String range) {
        return PREFIX + range + ":current";
    }

    static String zsetKey(String range, String version) {
        return PREFIX + range + ":v" + version;
    }

    static String metaKey(String range, String version) {
        return PREFIX + range + ":meta:v" + version;
    }

    /**
     * 榜单条目。重建与读取共用同一个形状。
     *
     * @param score 热度分数。**要展示给用户**——否则"为什么它排第一"没法解释
     */
    public record Entry(String postId, double score, String title,
                        String communityName, String authorId) {
        String metaJson() {
            return "{\"title\":" + json(title)
                    + ",\"communityName\":" + json(communityName)
                    + ",\"authorId\":" + json(authorId) + "}";
        }

        private static String json(String v) {
            if (v == null) {
                return "null";
            }
            StringBuilder sb = new StringBuilder("\"");
            for (char c : v.toCharArray()) {
                switch (c) {
                    case '"' -> sb.append("\\\"");
                    case '\\' -> sb.append("\\\\");
                    case '\n' -> sb.append("\\n");
                    case '\r' -> sb.append("\\r");
                    case '\t' -> sb.append("\\t");
                    default -> {
                        if (c < 0x20) {
                            sb.append(String.format("\\u%04x", (int) c));
                        } else {
                            sb.append(c);
                        }
                    }
                }
            }
            return sb.append('"').toString();
        }
    }

    /** 读榜单。没有重建过 / 榜单为空 / Redis 挂了都返回空页，不抛错 */
    public HotPage read(String range) {
        try {
            String version = redis.opsForValue().get(currentKey(range));
            if (version == null) {
                return new HotPage(range, List.of(), 0);
            }
            String zsetKey = zsetKey(range, version);
            String metaKey = metaKey(range, version);

            // ZREVRANGE 全部：榜上本来就只有 Top N，不需要分页
            var members = redis.opsForZSet().reverseRangeWithScores(zsetKey, 0, -1);
            if (members == null || members.isEmpty()) {
                return new HotPage(range, List.of(), 0);
            }

            List<String> ids = new ArrayList<>(members.size());
            for (var m : members) {
                ids.add(String.valueOf(m.getValue()));
            }
            List<Object> metas = redis.opsForHash().multiGet(metaKey, new ArrayList<>(ids));

            List<HotItem> items = new ArrayList<>(members.size());
            int rank = 0;
            int i = 0;
            for (var m : members) {
                Object raw = metas != null && i < metas.size() ? metas.get(i) : null;
                i += 1;
                if (!(raw instanceof String text)) {
                    // meta 丢了：跳过而不是显示一条空标题的条目。
                    // 下一轮重建就会补齐——这就是"投影可自愈"的好处
                    continue;
                }
                Entry e;
                try {
                    e = parseMeta(String.valueOf(m.getValue()), m.getScore(), text);
                } catch (Exception ex) {
                    log.warn("榜单 meta 解析失败 postId={} {}", m.getValue(), ex.toString());
                    continue;
                }
                rank += 1;
                items.add(new HotItem(rank, e.postId(), e.title(), e.communityName(),
                        e.authorId(), round(e.score())));
            }
            return new HotPage(range, items, items.size());
        } catch (Exception e) {
            // Redis 挂了：返回空榜而不是 500。
            // 热榜是可有可无的装饰，不能因为它让整个页面挂掉。
            log.warn("读取热榜失败 range={} {}", range, e.toString());
            return new HotPage(range, List.of(), 0);
        }
    }

    private Entry parseMeta(String postId, double score, String json) throws Exception {
        Map<?, ?> m = objectMapper.readValue(json, Map.class);
        return new Entry(postId, score,
                m.get("title") == null ? null : String.valueOf(m.get("title")),
                m.get("communityName") == null ? null : String.valueOf(m.get("communityName")),
                m.get("authorId") == null ? null : String.valueOf(m.get("authorId")));
    }

    /** 分数只保留一位小数。展示用的数字不需要 15 位有效数字 */
    private static double round(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
