package top.katzenyasax.kuaikan.community.web.dto;

/**
 * 内部接口的成员查询结果，给 content-service 发帖前校验用。
 *
 * **刻意不用抛异常表达"社群不存在"**：这是跨服务调用，把错误码跨服务映射一遍
 * 既啰嗦又容易错。这里把两种"不满足"都放在正常返回里：
 *
 *   exists=false → 社群不存在（content 侧转 41001）
 *   exists=true, member=false → 不是成员（content 侧转 41004）
 *
 * 内部查询接口回答的是"是什么"，不是"做什么"，所以它总是成功返回。
 */
public record MembershipResponse(
        boolean exists,
        boolean member,
        Integer role
) {
    public static MembershipResponse notFound() {
        return new MembershipResponse(false, false, null);
    }

    public static MembershipResponse of(boolean member, Integer role) {
        return new MembershipResponse(true, member, role);
    }
}
