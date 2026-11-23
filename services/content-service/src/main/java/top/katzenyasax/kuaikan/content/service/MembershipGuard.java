package top.katzenyasax.kuaikan.content.service;

import org.slf4j.Logger;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.error.CommunityErrorCode;
import top.katzenyasax.kuaikan.content.feign.CommunityMembershipClient;
import top.katzenyasax.kuaikan.content.feign.MembershipView;

/**
 * content 侧所有"问 community-service 要权限答案"的判断收口在这里。
 *
 * <h2>为什么单独抽一个类</h2>
 *
 * 发帖、发评论、管理员删他人帖子/评论是四条路径、三个调用点，
 * 但**判断顺序和错误码映射必须是同一套**：先 exists → 41001、
 * 再 banned → 41006、最后 !member → 41004。分散复制三份，
 * 迟早有一份把 banned 和 member 的顺序写反——而写反的表现是
 * 「被封禁的人还能发帖」，这是安全事故，不是 bug。
 *
 * <h2>50300 的含义</h2>
 *
 * 下游不可用（超时、连接拒绝、5xx、空 body）一律 50300，不重试：
 * 宁可这次发/删失败，也不要让"没权限的人"因为查不到权限而放行。
 * 重试会把 500ms 变成 1.5s，下游挂掉时收益为零、代价是线程被多占两倍时间。
 *
 * <h2>调用位置约定（事务边界）</h2>
 *
 * 本类的每个方法都会发起一次远程调用，**调用方必须保证它在数据库事务之外**，
 * 或者至少不让它延长事务持有时间。发帖/发评论的事务只包本地 SQL，
 * 删他人内容的权限查询也在事务外完成。
 */
final class MembershipGuard {

    /**
     * 封禁到期展示格式。**必须与 community-service 的 BAN_UNTIL_FORMAT 一样**：
     * 同一个用户在"加入社群"和"发帖"两个入口看到的提示必须逐字相同，
     * 否则会被当成两件不同的事。
     */
    private static final DateTimeFormatter BAN_UNTIL_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private MembershipGuard() {
    }

    /**
     * 写内容前的校验：存在 → 未封禁 → 是成员（P7 方案 §4.3）。
     *
     * 顺序不能换。banned 与 member 在正常数据下互斥（封禁会把成员行置为退出），
     * 但万一数据脏了、两个都成立，也必须让**封禁赢**——否则封禁成了一条
     * 可以靠脏数据绕过的建议。
     */
    static void requireCanWrite(CommunityMembershipClient client, Long communityId, Long userId,
                                String action, Logger log) {
        MembershipView view = fetch(client, communityId, userId, action, log);
        if (!view.exists()) {
            throw new BizException(CommunityErrorCode.COMMUNITY_NOT_FOUND);
        }
        if (view.banned()) {
            throw new BizException(CommunityErrorCode.COMMUNITY_BANNED, banMessage(view));
        }
        if (!view.member()) {
            throw new BizException(CommunityErrorCode.NOT_MEMBER);
        }
    }

    /**
     * 删他人内容前的校验：必须是该社群的管理员。
     *
     * 不满足统一 40300（不是 41007）：41007 是 community-service 的治理端点
     * 用的码，content 的删帖/删评对外语义一直是"没有权限"，
     * 保持 40300 不破坏 P2/P3 的既有断言。
     *
     * 社群不存在（exists=false）也走 40300：此时没人能证明自己是管理员，
     * 而抛 41001 会让人误以为"帖子所在的社群不见了"是本接口的问题。
     */
    static void requireCommunityAdmin(CommunityMembershipClient client, Long communityId, Long userId,
                                      String action, String forbiddenMessage, Logger log) {
        MembershipView view = fetch(client, communityId, userId, action, log);
        if (!view.exists() || !view.admin()) {
            throw new BizException(CommonErrorCode.FORBIDDEN, forbiddenMessage);
        }
    }

    /** 41006 的 message：原因 + 到期时间 / 永久，与 community-service 逐字一致 */
    static String banMessage(MembershipView view) {
        StringBuilder message = new StringBuilder(CommunityErrorCode.COMMUNITY_BANNED.message());
        if (view.banReason() != null && !view.banReason().isBlank()) {
            message.append("：").append(view.banReason());
        }
        message.append(banTail(view.bannedUntil()));
        return message.toString();
    }

    private static String banTail(LocalDateTime bannedUntil) {
        // banned=true 且 bannedUntil=null 表示永久封禁
        return bannedUntil == null ? "；永久封禁" : "；解封时间 " + BAN_UNTIL_FORMAT.format(bannedUntil);
    }

    private static MembershipView fetch(CommunityMembershipClient client, Long communityId, Long userId,
                                        String action, Logger log) {
        Result<MembershipView> result;
        try {
            result = client.membership(communityId, userId);
        } catch (Exception e) {
            log.error("{}：社群权限校验失败 communityId={} userId={}", action, communityId, userId, e);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        if (result == null || result.data() == null) {
            log.error("{}：社群权限校验返回空 body communityId={} userId={}", action, communityId, userId);
            throw new BizException(CommonErrorCode.UPSTREAM_UNAVAILABLE);
        }
        return result.data();
    }
}
