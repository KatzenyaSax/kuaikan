package top.katzenyasax.kuaikan.search.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.feign.CommunityDirectoryClient;
import top.katzenyasax.kuaikan.search.feign.UserDirectoryClient;
import top.katzenyasax.kuaikan.search.feign.dto.BatchCommunitiesRequest;
import top.katzenyasax.kuaikan.search.feign.dto.BatchUsersRequest;
import top.katzenyasax.kuaikan.search.feign.dto.CommunityNameView;
import top.katzenyasax.kuaikan.search.feign.dto.CommunityRefView;
import top.katzenyasax.kuaikan.search.feign.dto.InternalUserView;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 反范式字段（昵称 / 社群名）的补齐与缓存。
 *
 * <h2>社群名为什么要本地缓存</h2>
 *
 * 社群名创建后不可修改（它就是帖子 URL 的一部分），所以缓存**没有失效问题**。
 * 索引里每条帖子都带 {@code communityName}，而实际涉及的社群通常只有几十个 ——
 * 不缓存等于每写一条帖子就打一次 community-service。
 *
 * 上限 2000 条（Caffeine {@code maximumSize}），按最近使用淘汰：
 * 这是缓存，不是权威数据；被淘汰后下次查一次就回来了。
 *
 * <h2>降级值的边界</h2>
 *
 * <table>
 *   <tr><th>情况</th><th>结果</th><th>理由</th></tr>
 *   <tr><td>用户不存在 / 已注销</td><td>「已注销用户」</td>
 *       <td>帖子仍是事实，作者名字没了不代表帖子该消失</td></tr>
 *   <tr><td>社群不存在 / 已删</td><td>空字符串</td>
 *       <td>{@code communityName} 参与检索但不该是 null（null 不进倒排）</td></tr>
 *   <tr><td>下游 5xx / 超时</td><td><b>抛异常</b></td>
 *       <td>与服务重启无关的临时故障：消费端应重投，而不是把错误名字永久写进索引</td></tr>
 * </table>
 *
 * 第三条区分很关键：把"服务暂时不可用"当成"用户已注销"，会让几百条帖子
 * 永久带上「已注销用户」，且没有自愈路径（只能靠全量重建）。
 */
@Service
public class DirectoryService {

    private static final Logger log = LoggerFactory.getLogger(DirectoryService.class);

    /** 用户不存在时的降级昵称。与 notification 的 SnapshotService 保持同一个文案 */
    public static final String DELETED_NICKNAME = "已注销用户";

    /** 社群不存在时的降级值 */
    public static final String MISSING_COMMUNITY = "";

    /** 下游批量接口的上限，超出会被 40010 拒掉 */
    private static final int BATCH_LIMIT = 200;

    private final UserDirectoryClient userDirectoryClient;
    private final CommunityDirectoryClient communityDirectoryClient;

    /** 社群名不可变 → 永久缓存，无 TTL */
    private final Cache<Long, String> communityNames = Caffeine.newBuilder()
            .maximumSize(2000)
            .build();

    public DirectoryService(UserDirectoryClient userDirectoryClient,
                            CommunityDirectoryClient communityDirectoryClient) {
        this.userDirectoryClient = userDirectoryClient;
        this.communityDirectoryClient = communityDirectoryClient;
    }

    /**
     * 单个作者的昵称。消费路径用它（一条事件只有一个作者）。
     *
     * 内部仍然走批量接口：端点只有一套，少一套就少一种"两边行为不一致"的可能。
     */
    public String nickname(Long authorId) {
        if (authorId == null) {
            return DELETED_NICKNAME;
        }
        return nicknames(List.of(authorId)).getOrDefault(authorId, DELETED_NICKNAME);
    }

    /** 批量昵称。返回的 map 对每个入参 id 都有值（查不到 = 已注销用户） */
    public Map<Long, String> nicknames(Collection<Long> authorIds) {
        Set<Long> ids = distinct(authorIds);
        Map<Long, String> out = new HashMap<>(ids.size() * 2);
        for (List<Long> chunk : chunks(ids)) {
            List<String> raw = new ArrayList<>(chunk.size());
            for (Long id : chunk) {
                raw.add(String.valueOf(id));
            }
            Result<List<InternalUserView>> result =
                    userDirectoryClient.batch(new BatchUsersRequest(raw));
            List<InternalUserView> rows = require(result, "用户批量查询");
            Map<Long, String> found = new HashMap<>(rows.size() * 2);
            for (InternalUserView row : rows) {
                if (row != null && row.id() != null && row.nickname() != null) {
                    found.put(row.id(), row.nickname());
                }
            }
            for (Long id : chunk) {
                out.put(id, found.getOrDefault(id, DELETED_NICKNAME));
            }
        }
        return out;
    }

    /**
     * 单个社群的名称。命中 Caffeine 时零网络调用。
     *
     * {@code Cache.get} 的 mapping function **不缓存异常**：下游抖动会让这次调用抛出去，
     * 下次重试重新查，而不是把"暂时查不到"当成空字符串永久记住。
     */
    public String communityName(Long communityId) {
        if (communityId == null) {
            return MISSING_COMMUNITY;
        }
        return communityNames.get(communityId, this::fetchCommunityName);
    }

    /** 批量社群名。命中的走缓存，未命中的按 200 分片批量拉一次 */
    public Map<Long, String> communityNames(Collection<Long> communityIds) {
        Set<Long> ids = distinct(communityIds);
        Map<Long, String> out = new HashMap<>(ids.size() * 2);
        List<Long> missing = new ArrayList<>();
        for (Long id : ids) {
            String cached = communityNames.getIfPresent(id);
            if (cached != null) {
                out.put(id, cached);
            } else {
                missing.add(id);
            }
        }
        for (List<Long> chunk : chunks(missing)) {
            List<String> raw = new ArrayList<>(chunk.size());
            for (Long id : chunk) {
                raw.add(String.valueOf(id));
            }
            Result<List<CommunityNameView>> result =
                    communityDirectoryClient.batch(new BatchCommunitiesRequest(raw));
            List<CommunityNameView> rows = require(result, "社群批量查询");
            Map<Long, String> found = new HashMap<>(rows.size() * 2);
            for (CommunityNameView row : rows) {
                if (row != null && row.id() != null && row.name() != null) {
                    found.put(row.id(), row.name());
                }
            }
            for (Long id : chunk) {
                String name = found.getOrDefault(id, MISSING_COMMUNITY);
                communityNames.put(id, name);
                out.put(id, name);
            }
        }
        return out;
    }

    /** 单条路径：查不到 / 已删除都降级为空字符串 */
    private String fetchCommunityName(Long communityId) {
        Result<CommunityRefView> result = communityDirectoryClient.byId(communityId);
        CommunityRefView ref = result == null ? null : result.data();
        if (ref == null) {
            // 空 body 是契约异常，不是"社群不存在"。抛出去让消费端重投
            throw new IllegalStateException("社群查询返回空 body communityId=" + communityId);
        }
        if (!ref.exists() || ref.name() == null) {
            log.debug("社群不存在，索引降级为空字符串 communityId={}", communityId);
            return MISSING_COMMUNITY;
        }
        return ref.name();
    }

    private static <T> List<T> require(Result<List<T>> result, String what) {
        List<T> rows = result == null ? null : result.data();
        if (rows == null) {
            throw new IllegalStateException(what + "返回空 body");
        }
        return rows;
    }

    private static Set<Long> distinct(Collection<Long> ids) {
        Set<Long> out = new LinkedHashSet<>();
        if (ids != null) {
            for (Long id : ids) {
                if (id != null) {
                    out.add(id);
                }
            }
        }
        return out;
    }

    private static List<List<Long>> chunks(Collection<Long> ids) {
        List<Long> all = new ArrayList<>(ids);
        List<List<Long>> out = new ArrayList<>();
        for (int from = 0; from < all.size(); from += BATCH_LIMIT) {
            out.add(all.subList(from, Math.min(from + BATCH_LIMIT, all.size())));
        }
        return out;
    }
}
