package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.feign.InteractionCountClient;
import top.katzenyasax.kuaikan.content.feign.TargetCountView;
import top.katzenyasax.kuaikan.content.mapper.CountReconcileMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 计数对账：用**事实**重算，覆盖式写入。
 *
 * <b>为什么必须有它</b>：outbox + 幂等解决了"重复投递"和"投递失败重试"，
 * 但解决不了三种情况——
 *   1. 事件超过重试上限被放弃（t_outbox.status=2）
 *   2. 消费逻辑本身有 bug
 *   3. 有人手工改过计数
 * 这三种都会让计数永久停在错误值。对账是最后一道防线（ADR 0010）。
 *
 * <b>为什么是"遍历自己的目标 + 问 interaction 要真值"</b>：
 * content 的账号只有本库权限（ADR 0006），读不到 t_interaction。
 * 而且**必须遍历自己所有的目标**——只问"有互动的目标"会让
 * "计数应该归零"的那些永远修不回来，而那恰恰是最常见的错（点赞全取消后卡在旧值）。
 *
 * <b>覆盖写而不是增量</b>：对账的全部意义就是"不相信当前的计数"。
 */
@Service
public class CountReconciler {

    private static final Logger log = LoggerFactory.getLogger(CountReconciler.class);

    /**
     * 一次问 interaction 多少个目标。
     *
     * **不能超过 interaction 侧的上限**（那边是 200）：这批目标走 GET 的 query string，
     * 一个雪花 id 的 token 约 24 字节，200 个约 5KB，接近但低于 Tomcat 默认 8KB 的
     * header 上限；500 个会直接 400。
     * 如果以后要放大，得先把那个内部接口改成 POST + body。
     */
    private static final int BATCH = 200;

    private final CountReconcileMapper mapper;
    private final InteractionCountClient countClient;

    public CountReconciler(CountReconcileMapper mapper, InteractionCountClient countClient) {
        this.mapper = mapper;
        this.countClient = countClient;
    }

    /** 每 10 分钟一次。P7 换 XXL-Job（多实例、可观测） */
    @Scheduled(fixedDelayString = "${kuaikan.reconcile.interval:10m}")
    public void scheduled() {
        try {
            reconcileAll();
        } catch (Exception e) {
            // 定时任务里抛异常可能让后续调度停掉，这里必须自己吞住
            log.error("定时对账失败", e);
        }
    }

    /**
     * 全量重算。
     *
     * P3 数据量小，全表扫即可。数据长大后要改成"只重算近期活跃的目标"（P5）。
     * 现在做增量对账等于为不存在的问题写代码。
     */
    public Map<String, Object> reconcileAll() {
        long start = System.currentTimeMillis();
        int fixed = 0;

        // 帖子：like_count + favorite_count
        long cursor = 0;
        while (true) {
            List<Long> ids = mapper.pagePostIds(cursor, BATCH);
            if (ids.isEmpty()) {
                break;
            }
            fixed += applyBatch("post", ids, true);
            cursor = ids.get(ids.size() - 1);
        }

        // 评论：只有 like_count
        cursor = 0;
        while (true) {
            List<Long> ids = mapper.pageCommentIds(cursor, BATCH);
            if (ids.isEmpty()) {
                break;
            }
            fixed += applyBatch("comment", ids, false);
            cursor = ids.get(ids.size() - 1);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fixed", fixed);
        // 用 int 而不是 long：Map 里放的 boxed Long 会被全局 Long→String 规则
        // 序列化成 "120" 而不是 120，看返回值的人会以为哪里出错了。
        result.put("elapsedMs", (int) (System.currentTimeMillis() - start));
        log.info("对账完成 {}", result);
        return result;
    }

    /** 一批目标：问 interaction 要真值，覆盖写。返回实际修正的行数 */
    private int applyBatch(String type, List<Long> ids, boolean withFavorite) {
        StringBuilder sb = new StringBuilder();
        for (Long id : ids) {
            if (sb.length() > 0) {
                sb.append(',');
            }
            sb.append(type).append(':').append(id);
        }

        Result<List<TargetCountView>> result;
        try {
            result = countClient.counts(sb.toString());
        } catch (Exception e) {
            // interaction 不可用时这一轮对账失败，下一轮会重试。
            // 不吞掉整轮：已处理的批次已经修好了。
            log.error("对账取真值失败 type={} 批量={}", type, ids.size(), e);
            return 0;
        }
        if (result == null || result.data() == null) {
            log.error("对账取真值返回空 body type={}", type);
            return 0;
        }

        Map<Long, TargetCountView> byId = new LinkedHashMap<>();
        for (TargetCountView v : result.data()) {
            byId.put(v.targetId(), v);
        }

        int fixed = 0;
        for (Long id : ids) {
            TargetCountView v = byId.get(id);
            // 没返回的按 0 处理：这正是"该归零"的情况
            long like = v == null ? 0 : v.likeCount();
            long favorite = v == null ? 0 : v.favoriteCount();
            int rows = "post".equals(type)
                    ? mapper.overwritePostCounts(id, like, withFavorite ? favorite : null)
                    : mapper.overwriteCommentLikeCount(id, like);
            fixed += rows;
        }
        return fixed;
    }
}
