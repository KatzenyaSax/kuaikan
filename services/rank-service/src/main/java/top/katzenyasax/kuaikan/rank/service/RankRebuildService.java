package top.katzenyasax.kuaikan.rank.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.rank.config.RankProperties;
import top.katzenyasax.kuaikan.rank.feign.CommunityRefClient;
import top.katzenyasax.kuaikan.rank.feign.ContentRankClient;
import top.katzenyasax.kuaikan.rank.feign.InteractionDeltaClient;
import top.katzenyasax.kuaikan.rank.feign.dto.CommunityRefView;
import top.katzenyasax.kuaikan.rank.feign.dto.RankCandidateView;
import top.katzenyasax.kuaikan.rank.feign.dto.SinceRequestView;
import top.katzenyasax.kuaikan.rank.feign.dto.SinceResponseView;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 热榜重建。每 5 分钟一次，全量重算，版本化原子切换。
 *
 * <h2>为什么是"定时全量重算"而不是"有交互就重算"</h2>
 *
 * 候选集是**查询条件**（`created_at >= since OR last_interaction_at >= since`），
 * 不是显式维护的数据结构。显式候选集要处理过期清理、丢了要重建，
 * 而 rank 是纯投影，最大的性质就是**可以随时全量重建**。
 *
 * 定时 5 分钟的实时性对热榜完全够；"每次交互都重算"会给热点帖造成写放大。
 *
 * <h2>为什么版本化而不是 RENAME</h2>
 *
 * 榜单有两个 key（ZSet 存分数、Hash 存标题）。RENAME 两次之间有窗口，
 * 读者可能看到"新分数配旧标题"。用版本号时，**只有一条 SET 是切换点**：
 *
 * <pre>
 *   rank:hot:day:v42        ZSet
 *   rank:hot:day:meta:v42   Hash
 *   rank:hot:day:current -> 42      ← 唯一的原子切换
 * </pre>
 *
 * <h2>为什么失败时保留上一版</h2>
 *
 * 拿不到 content 或 interaction 的数据时**不动 current**。
 * 清空榜单会让用户看到"热榜空了"，而实际上只是下游抖了一下。
 * 投影坏了要退化，不能连坐。
 */
@Service
public class RankRebuildService {

    private static final Logger log = LoggerFactory.getLogger(RankRebuildService.class);

    /** 每次向 content / interaction 分批要多少个 id。上限 200，取 100 更安全 */
    private static final int DELTA_BATCH = 100;
    /** 候选帖一页拉多少 */
    private static final int CANDIDATE_PAGE = 100;
    /** 最多拉多少页，防止下游异常时死循环 */
    private static final int MAX_PAGES = 200;

    /** 旧版本 key 的存活时间。活过一轮重建就够，之后自然过期 */
    private static final Duration OLD_VERSION_TTL = Duration.ofMinutes(30);

    private final RankProperties props;
    private final HeatFormula formula;
    private final ContentRankClient contentClient;
    private final InteractionDeltaClient interactionClient;
    private final CommunityRefClient communityClient;
    private final StringRedisTemplate redis;

    /** 社群名不可变，可以永久缓存。上限防止无限增长 */
    private final Map<Long, String> communityNames = new ConcurrentHashMap<>();

    public RankRebuildService(RankProperties props,
                              HeatFormula formula,
                              ContentRankClient contentClient,
                              InteractionDeltaClient interactionClient,
                              CommunityRefClient communityClient,
                              StringRedisTemplate redis) {
        this.props = props;
        this.formula = formula;
        this.contentClient = contentClient;
        this.interactionClient = interactionClient;
        this.communityClient = communityClient;
        this.redis = redis;
    }

    @Scheduled(fixedDelayString = "${kuaikan.rank.rebuild-interval:5m}",
            initialDelayString = "${kuaikan.rank.initial-delay:10s}")
    public void rebuildAll() {
        // 两个榜独立重建：日榜失败不该连累周榜
        rebuild("day", props.getDayHalfLifeHours());
        rebuild("week", props.getWeekHalfLifeHours());
    }

    /** @return true = 本次重建成功并已切换 */
    public boolean rebuild(String range, int halfLifeHours) {
        long sinceMillis = System.currentTimeMillis()
                - (long) props.getCandidateSpan() * halfLifeHours * 3600_000L;
        try {
            List<RankCandidateView> candidates = fetchCandidates(sinceMillis);
            if (candidates.isEmpty()) {
                // 空候选是正常状态（新部署、数据被清空）。写一个空榜而不是保留旧数据，
                // 否则"帖全删了但榜还在"会显得很诡异。
                publish(range, halfLifeHours, List.of());
                log.info("热榜 {} 重建完成：无候选", range);
                return true;
            }

            Map<String, SinceResponseView> deltas = fetchDeltas(candidates, sinceMillis);
            List<RankQueryService.Entry> ranked = score(candidates, deltas, halfLifeHours);
            publish(range, halfLifeHours, ranked);
            log.info("热榜 {} 重建完成：候选 {} 条，上榜 {} 条",
                    range, candidates.size(), ranked.size());
            return true;
        } catch (Exception e) {
            // 保留上一版：不动 current。用户看到的是 5 分钟前的榜，而不是空榜
            log.warn("热榜 {} 重建失败，保留上一版：{}", range, e.toString());
            return false;
        }
    }

    private List<RankCandidateView> fetchCandidates(long sinceMillis) {
        List<RankCandidateView> all = new ArrayList<>();
        Long cursor = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            Result<List<RankCandidateView>> result =
                    contentClient.candidates(sinceMillis, cursor, CANDIDATE_PAGE);
            List<RankCandidateView> rows = result == null ? null : result.data();
            if (rows == null) {
                throw new IllegalStateException("候选帖接口返回空 body");
            }
            if (rows.isEmpty()) {
                break;
            }
            all.addAll(rows);
            if (rows.size() < CANDIDATE_PAGE) {
                break;
            }
            cursor = rows.get(rows.size() - 1).postId();
        }
        return all;
    }

    /** 分批向 interaction 要窗口增量。超过服务端上限（200）会 40010，所以取 100 */
    private Map<String, SinceResponseView> fetchDeltas(List<RankCandidateView> candidates,
                                                       long sinceMillis) {
        Map<String, SinceResponseView> out = new HashMap<>();
        List<String> ids = new ArrayList<>(candidates.size());
        for (RankCandidateView c : candidates) {
            ids.add(String.valueOf(c.postId()));
        }
        for (int i = 0; i < ids.size(); i += DELTA_BATCH) {
            List<String> batch = ids.subList(i, Math.min(i + DELTA_BATCH, ids.size()));
            Result<List<SinceResponseView>> result = interactionClient.since(
                    new SinceRequestView("POST", sinceMillis, new ArrayList<>(batch)));
            List<SinceResponseView> rows = result == null ? null : result.data();
            if (rows == null) {
                throw new IllegalStateException("窗口增量接口返回空 body");
            }
            for (SinceResponseView r : rows) {
                out.put(r.targetId(), r);
            }
        }
        return out;
    }

    private List<RankQueryService.Entry> score(List<RankCandidateView> candidates,
                                               Map<String, SinceResponseView> deltas,
                                               int halfLifeHours) {
        long now = System.currentTimeMillis();
        List<RankQueryService.Entry> all = new ArrayList<>(candidates.size());
        for (RankCandidateView c : candidates) {
            SinceResponseView d = deltas.get(String.valueOf(c.postId()));
            long likeDelta = d == null ? 0 : d.likeDelta();
            long favoriteDelta = d == null ? 0 : d.favoriteDelta();

            // 衰减基准：lastInteractionAt；缺失时退回 createdAt（历史数据可能没有）
            LocalDateTime base = c.lastInteractionAt() != null
                    ? c.lastInteractionAt() : c.createdAt();
            double hours = hoursBetween(base, now);

            double score = formula.score(c.recentCommentCount(), likeDelta, favoriteDelta,
                    c.shareCount(), c.viewCount(), hours, halfLifeHours);
            if (score < props.getMinScore()) {
                continue;
            }
            all.add(new RankQueryService.Entry(
                    String.valueOf(c.postId()),
                    score,
                    c.title(),
                    communityName(c.communityId()),
                    c.authorId() == null ? null : String.valueOf(c.authorId())));
        }
        all.sort(Comparator.comparingDouble(RankQueryService.Entry::score).reversed()
                .thenComparing(RankQueryService.Entry::postId));
        return all.size() > props.getTopN() ? all.subList(0, props.getTopN()) : all;
    }

    private static double hoursBetween(LocalDateTime from, long nowMillis) {
        if (from == null) {
            return 0;
        }
        long fromMillis = from.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        return Math.max(0, (nowMillis - fromMillis) / 3_600_000.0);
    }

    private String communityName(Long communityId) {
        if (communityId == null) {
            return null;
        }
        String cached = communityNames.get(communityId);
        if (cached != null) {
            return cached;
        }
        try {
            Result<CommunityRefView> result = communityClient.byId(communityId);
            CommunityRefView ref = result == null ? null : result.data();
            if (ref == null || !ref.exists() || ref.name() == null) {
                return null;
            }
            if (communityNames.size() < 1000) {
                communityNames.put(communityId, ref.name());
            }
            return ref.name();
        } catch (Exception e) {
            // 拿不到社群名不影响上榜——只是前端少显示一行
            log.debug("社群名解析失败 communityId={} {}", communityId, e.toString());
            return null;
        }
    }

    /**
     * 写入新版本并切换。
     *
     * 顺序很重要：**先把新版本的 ZSet 和 Hash 全写完，最后才改 current**。
     * 反过来会让读者看到一个只写了一半的榜。
     */
    private void publish(String range, int halfLifeHours, List<RankQueryService.Entry> entries) {
        String version = String.valueOf(System.currentTimeMillis());
        String zsetKey = RankQueryService.zsetKey(range, version);
        String metaKey = RankQueryService.metaKey(range, version);

        if (!entries.isEmpty()) {
            // 50 条 ZADD：对 5 分钟一次的定时任务完全够，不需要 pipeline 的复杂度
            for (RankQueryService.Entry e : entries) {
                redis.opsForZSet().add(zsetKey, e.postId(), e.score());
            }
            Map<String, String> meta = new HashMap<>();
            for (RankQueryService.Entry e : entries) {
                meta.put(e.postId(), e.metaJson());
            }
            redis.opsForHash().putAll(metaKey, meta);
        }

        // 新版本给一个 TTL：它被下一版取代后自然会过期，不需要显式清理
        redis.expire(zsetKey, OLD_VERSION_TTL);
        redis.expire(metaKey, OLD_VERSION_TTL);

        // 唯一的原子切换
        redis.opsForValue().set(RankQueryService.currentKey(range), version);
        log.debug("热榜 {} 已切换到版本 {}（{} 条，H={}h）", range, version, entries.size(), halfLifeHours);
    }
}
