package top.katzenyasax.kuaikan.community.web.dto;

import java.time.LocalDateTime;

/**
 * 内部接口的成员查询结果，给 content-service 发帖/评论/删帖前校验用。
 *
 * **刻意不用抛异常表达"社群不存在"**：这是跨服务调用，把错误码跨服务映射一遍
 * 既啰嗦又容易错。这里把两种"不满足"都放在正常返回里：
 *
 *   exists=false → 社群不存在（content 侧转 41001）
 *   exists=true, banned=true → 被该社群封禁（content 侧转 41006）
 *   exists=true, member=false → 不是成员（content 侧转 41004）
 *   exists=true, admin=true  → 管理员，可删他人的帖子/评论（P7.2）
 *
 * 内部查询接口回答的是"是什么"，不是"做什么"，所以它总是成功返回。
 *
 * P7.1 在原有三字段之后**追加**四个字段，全部是新增、不改语义：
 * 旧的调用方（只认 exists/member/role）不受影响。刻意不把它们做成嵌套对象——
 * content 侧的 MembershipView 是一份独立声明，扁平结构改动面最小。
 *
 * 状态组合的不变量：
 *   - 管理员（owner）永远 admin=true / member=true / banned=false：
 *     封禁自己是 41008，转让后 owner_id 已经不是他，这两种状态不会共存
 *   - banned=true 时 member 一定是 false：封禁会把在社的成员行置为已退出，
 *     即使数据脏了还留着 status=1 的成员行，这里也一律按"不是成员"回答——
 *     判断顺序比数据一致性更值得依赖
 */
public record MembershipResponse(
        boolean exists,
        boolean member,
        Integer role,
        boolean admin,
        boolean banned,
        String banReason,
        LocalDateTime bannedUntil
) {
    public static MembershipResponse notFound() {
        return new MembershipResponse(false, false, null, false, false, null, null);
    }

    public static MembershipResponse of(boolean member, Integer role, boolean admin) {
        return new MembershipResponse(true, member, role, admin, false, null, null);
    }

    /**
     * 被有效封禁。
     *
     * {@code bannedUntil} 为 null 且 banned=true 表示**永久封禁**——
     * content 侧拼提示文案时要靠这一点区分「封到某天」和「永久」。
     */
    public static MembershipResponse banned(boolean admin, String reason, LocalDateTime bannedUntil) {
        return new MembershipResponse(true, false, null, admin, true, reason, bannedUntil);
    }
}
