package top.katzenyasax.kuaikan.notification.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.notification.feign.CommunityDirectoryClient;
import top.katzenyasax.kuaikan.notification.feign.ContentTargetClient;
import top.katzenyasax.kuaikan.notification.feign.UserDirectoryClient;
import top.katzenyasax.kuaikan.notification.feign.dto.TargetView;
import top.katzenyasax.kuaikan.notification.feign.dto.CommunityRef;
import top.katzenyasax.kuaikan.notification.feign.dto.UserSummaryView;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 给消息拼快照：拉 actor 的昵称头像、拉 target 的标题摘录。
 *
 * <h2>为什么在消费时拉，而不是让生产方写进事件载荷</h2>
 *
 * 若让 interaction 把 actorNickname 写进 {@code InteractionChange}，
 * 那"点赞"就要依赖 user-service 的可用性——正是 ADR 0009 否掉的那种依赖倒挂，
 * 只是换了个方向。
 *
 * 而这里的失败代价完全不同：ADR 0009 里快照的代价是**发帖可能失败**（用户直接看到错误），
 * 这里的代价是**消息晚几秒到**（用户根本不知道）。
 *
 * <h2>失败必须分类，否则消费组会被堵死</h2>
 *
 * <table>
 *   <tr><th>情况</th><th>判据</th><th>动作</th></tr>
 *   <tr><td>用户/内容已删除</td><td>空数组 / exists=false</td>
 *       <td>{@link SnapshotResult#GONE}，**不重试**，落降级文案</td></tr>
 *   <tr><td>服务暂时不可用</td><td>连接失败 / 5xx</td>
 *       <td>抛异常 → MQ 重投</td></tr>
 * </table>
 *
 * 不分类的后果很具体：一个被删的用户会让这条事件**永远重投**，
 * 占住消费线程，后面的消息一条也进不来。
 */
@Service
public class SnapshotService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotService.class);

    /** 已注销用户的降级文案。不重试，但消息照发——那是历史事实 */
    public static final String DELETED_NICKNAME = "已注销用户";

    public enum Status {
        /** 快照可用 */
        OK,
        /** 目标已删除。消息仍然有意义（"曾有人赞过你"），但跳转过去看不到内容 */
        GONE
    }

    /**
     * @param nickname 已注销时为 {@link #DELETED_NICKNAME}
     */
    public record Actor(Status status, Long id, String nickname, String avatarUrl) {
    }

    public record Target(Status status, Long ownerId, String title, String excerpt,
                         Long postId, Long communityId) {
    }

    private final UserDirectoryClient userDirectoryClient;
    private final ContentTargetClient contentTargetClient;
    private final CommunityDirectoryClient communityDirectoryClient;

    /** 社群名不可变，可以永久缓存。上限防止无限增长 */
    private final Map<Long, String> communityNameCache = new ConcurrentHashMap<>();

    public SnapshotService(UserDirectoryClient userDirectoryClient,
                           ContentTargetClient contentTargetClient,
                           CommunityDirectoryClient communityDirectoryClient) {
        this.userDirectoryClient = userDirectoryClient;
        this.contentTargetClient = contentTargetClient;
        this.communityDirectoryClient = communityDirectoryClient;
    }

    /**
     * 拉 actor。用户被删不是错误——只是在消息里显示"已注销用户"。
     *
     * <b>网络故障会抛异常</b>，由调用方决定重投。
     */
    public Actor actor(Long actorId) {
        if (actorId == null) {
            return new Actor(Status.GONE, null, DELETED_NICKNAME, null);
        }
        Result<List<UserSummaryView>> result = userDirectoryClient.batch(String.valueOf(actorId));
        List<UserSummaryView> users = result == null ? null : result.data();
        if (users == null) {
            // 返回体为空 = 契约异常，不是"用户不存在"。当故障处理，让 MQ 重投。
            throw new IllegalStateException("用户摘要返回空 body actorId=" + actorId);
        }
        Optional<UserSummaryView> found = users.stream()
                .filter(u -> actorId.equals(u.userId()))
                .findFirst();
        // 查不到 = 账号已注销（接口会过滤 deleted_at 不为空的用户）。
        // 这是**不可重试**的情况：重投一百次还是查不到。
        return found
                .map(u -> new Actor(Status.OK, u.userId(), u.nickname(), u.avatarUrl()))
                .orElseGet(() -> new Actor(Status.GONE, actorId, DELETED_NICKNAME, null));
    }

    /**
     * 拉 target 的标题与摘录。目标被删同理：不重试，消息照发。
     */
    public Target target(String targetType, Long targetId) {
        if (targetType == null || targetId == null) {
            return new Target(Status.GONE, null, null, null, null, null);
        }
        String type = "POST".equals(targetType) ? "post" : "comment";
        Result<TargetView> result = contentTargetClient.target(type, targetId);
        TargetView view = result == null ? null : result.data();
        if (view == null) {
            throw new IllegalStateException("目标查询返回空 body target=" + targetType + ":" + targetId);
        }
        if (!view.exists()) {
            // 内容被删了。消息仍然发（"曾有人赞过你"是事实），只是点过去看不到
            return new Target(Status.GONE, view.ownerId(), null, null, view.postId(), view.communityId());
        }
        return new Target(Status.OK, view.ownerId(), view.title(), view.excerpt(),
                view.postId(), view.communityId());
    }

    /**
     * 社群 id -> 名字。
     *
     * <b>可以永久缓存</b>：社群名创建后不可改（它就是 URL），不存在失效问题。
     * 上限 1000 条防止无限增长——一个实例处理过的社群通常只有几十个。
     */
    public String communityName(Long communityId) {
        if (communityId == null) {
            return null;
        }
        String cached = communityNameCache.get(communityId);
        if (cached != null) {
            return cached;
        }
        Result<CommunityRef> result = communityDirectoryClient.byId(communityId);
        CommunityRef ref = result == null ? null : result.data();
        if (ref == null) {
            throw new IllegalStateException("社群查询返回空 body communityId=" + communityId);
        }
        if (!ref.exists() || ref.name() == null) {
            // 社群被删了。消息照发，只是点不进去
            return null;
        }
        if (communityNameCache.size() < 1000) {
            communityNameCache.put(communityId, ref.name());
        }
        return ref.name();
    }

    /** 快照里冗长的正文只留一小段 */
    public static String trim(String text, int max) {
        if (text == null) {
            return null;
        }
        String flat = text.strip();
        return flat.length() <= max ? flat : flat.substring(0, max) + "…";
    }
}
