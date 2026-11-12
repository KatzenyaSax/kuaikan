package top.katzenyasax.kuaikan.common.error;

/**
 * 社群相关错误码（410xx）。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验。
 *
 * 关键约定：
 *   - **没有「已是成员」这个码。** 加入/退出都设计成幂等成功（重复加入返回 code 0，
 *     member_count 不变）。幂等靠 `INSERT … ON DUPLICATE KEY UPDATE` + 判 affectedRows，
 *     与 P3 消费幂等是同一个手法。有「已是成员」这个码，就意味着调用方要区分
 *     「刚加入」和「本来就加入了」，而这两者在业务上不需要区分。
 *   - NOT_MEMBER 走 HTTP 200 + 业务码，它是**业务规则**不是传输层错误。
 */
public enum CommunityErrorCode implements ErrorCode {

    COMMUNITY_NOT_FOUND(41001, "社群不存在"),
    COMMUNITY_NAME_TAKEN(41002, "该社群名称已被使用"),
    /** 发帖、发评论等写操作要求调用者是该社群成员 */
    NOT_MEMBER(41004, "需要先加入社群"),

    /**
     * 所有者退出社群。
     *
     * 所有者退出后会变成"不是成员的所有者"，既不能发帖、社群也没人管。
     * 转让能力在 P7，中间这段时间只能由管理员改库——这是 P2 的已知缺口，
     * 不是遗漏。
     */
    OWNER_CANNOT_LEAVE(41005, "社群创建者不能退出");

    private final int code;
    private final String message;

    CommunityErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    @Override
    public int code() {
        return code;
    }

    @Override
    public String message() {
        return message;
    }
}
