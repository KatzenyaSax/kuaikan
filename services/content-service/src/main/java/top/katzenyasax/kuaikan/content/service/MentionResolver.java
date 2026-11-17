package top.katzenyasax.kuaikan.content.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.feign.MembershipView;
import top.katzenyasax.kuaikan.content.feign.UserDirectoryClient;
import top.katzenyasax.kuaikan.content.feign.dto.UserSummaryView;
import top.katzenyasax.kuaikan.content.web.dto.MentionView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 把评论正文里的 `@昵称` 解析成 userId。
 *
 * <h2>整个解析是"尽力而为"的</h2>
 *
 * 任何一步失败（user-service 挂了、community-service 超时、序列化失败）
 * 都只记 WARN 并返回空列表，**绝不让评论发不出去**。
 *
 * 理由同 ADR 0009：<b>评论能不能发出去，比 @ 准不准重要得多。</b>
 * 把一条 @ 解析挂在写路径上，等于把评论的可用性绑到另外两个服务的健康度上。
 * 失败的表现只是"这条 @ 没有变成蓝色链接"，用户仍然发得出去。
 *
 * <h2>@ 只对本社群成员生效</h2>
 *
 * 用户列表用 {@link UserDirectoryClient} 按昵称反查，再用
 * {@link CommunityMembershipClient} 逐个确认是不是本社群成员。
 *
 * 复用已有的 memberships 端点而不是新建"成员列表"端点，是因为：
 * 候选只有 1~3 个，逐个问比拉一份成员列表更省，
 * 而且它已经在这条写路径上了（发评论本来就要校验成员）。
 *
 * <h2>已知限制：昵称里有空格或标点时无法被 @</h2>
 *
 * 昵称只校验了长度（2~32），没有字符集限制。但解析必须先靠正则找出候选边界，
 * 而正则不可能在不知道完整昵称表的情况下判断"名字在哪结束"。
 *
 * 所以规则是：`@` 后面连续的中英文、数字、下划线、连字符才算候选。
 * `@张 三` 会被截成 `张`，匹配不到人，退化成普通文字。
 *
 * 这是有意的取舍：另一种做法是拉全社群昵称表再做最长匹配，
 * 那要在评论写路径上多一次批量查询，为了极少数带空格的昵称不值得。
 */
@Service
public class MentionResolver {

    private static final Logger log = LoggerFactory.getLogger(MentionResolver.class);

    /**
     * `@` + 1~32 个"像昵称"的字符。
     *
     * 字符类用 {@code \p{L}}（任何语言的字母，含中文）与 {@code \p{N}}（数字），
     * 而不是 {@code \w}——后者在 Java 默认只认 ASCII。
     * 中文逗号 `，`、句号、空格、emoji 都不在类里，天然成为边界。
     */
    private static final Pattern MENTION = Pattern.compile("@([\\p{L}\\p{N}_-]{1,32})");

    /** 正文里最多解析这么多个候选。再多就是刷屏，不是正常评论 */
    private static final int MAX_CANDIDATES = 5;

    private final UserDirectoryClient userDirectoryClient;
    private final CommunityMembershipClient membershipClient;
    private final ObjectMapper objectMapper;

    public MentionResolver(UserDirectoryClient userDirectoryClient,
                           CommunityMembershipClient membershipClient,
                           ObjectMapper objectMapper) {
        this.userDirectoryClient = userDirectoryClient;
        this.membershipClient = membershipClient;
        this.objectMapper = objectMapper;
    }

    /**
     * @return 解析成功且确为本社群成员的 @ 列表；任何异常都返回空列表，不抛出
     */
    public List<MentionView> resolve(String body, Long communityId) {
        if (body == null || body.isEmpty()) {
            return List.of();
        }

        Set<String> candidates = extractCandidates(body);
        if (candidates.isEmpty()) {
            return List.of();
        }

        List<UserSummaryView> users = lookup(candidates);
        if (users.isEmpty()) {
            return List.of();
        }

        // 昵称没有唯一约束：同一昵称可能命中多个人。
        // 取 userId 最小的那个——这是已定的规则，不是随机行为。
        Map<String, UserSummaryView> byNickname = new LinkedHashMap<>();
        for (UserSummaryView u : users) {
            UserSummaryView existing = byNickname.get(u.nickname());
            if (existing == null || u.userId() < existing.userId()) {
                byNickname.put(u.nickname(), u);
            }
        }

        List<MentionView> out = new ArrayList<>(byNickname.size());
        for (Map.Entry<String, UserSummaryView> e : byNickname.entrySet()) {
            UserSummaryView u = e.getValue();
            if (!isMember(communityId, u.userId())) {
                continue;
            }
            out.add(new MentionView(String.valueOf(u.userId()), e.getKey()));
        }
        return out;
    }

    /** 从正文里抽候选昵称，保持出现顺序、去重 */
    private static Set<String> extractCandidates(String body) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = MENTION.matcher(body);
        while (m.find() && out.size() < MAX_CANDIDATES) {
            out.add(m.group(1));
        }
        return out;
    }

    private List<UserSummaryView> lookup(Set<String> candidates) {
        try {
            Result<List<UserSummaryView>> result =
                    userDirectoryClient.byNicknames(String.join(",", candidates));
            if (result == null || result.data() == null) {
                log.warn("昵称解析返回空 body，候选={}", candidates);
                return List.of();
            }
            return result.data();
        } catch (Exception e) {
            // 降级：评论照常发，只是没有蓝色 @
            log.warn("昵称解析失败，本次评论不产生 @。候选={} 原因={}", candidates, e.toString());
            return List.of();
        }
    }

    private boolean isMember(Long communityId, Long userId) {
        try {
            Result<MembershipView> result = membershipClient.membership(communityId, userId);
            return result != null && result.data() != null && result.data().joined();
        } catch (Exception e) {
            // 同样是降级：不确定就当没 @
            log.warn("成员校验失败，跳过该 @ communityId={} userId={} 原因={}",
                    communityId, userId, e.toString());
            return false;
        }
    }

    /** 序列化成落库的 JSON。失败返回 null（等于没有 @），不抛 */
    public String toJson(List<MentionView> mentions) {
        if (mentions == null || mentions.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(mentions);
        } catch (Exception e) {
            log.warn("提及序列化失败，放弃写入 mentions：{}", e.toString());
            return null;
        }
    }

    /** 读回来看。脏数据一律降级成空列表，不让一条坏 JSON 把整页评论搞挂 */
    public List<MentionView> fromJson(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, MentionView.class));
        } catch (Exception e) {
            log.warn("mentions JSON 解析失败，按无 @ 处理：{}", e.toString());
            return List.of();
        }
    }
}
