package top.katzenyasax.kuaikan.common.error;

/**
 * 用户与社交关系相关错误码（402xx 段，与 {@link AuthErrorCode} 共用 402 前缀）。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验。
 *
 * 关键约定：
 *   - {@link #USER_NOT_FOUND} 走真实的 HTTP 404：它描述的是「路径里那个用户不存在」，
 *     与「资源不存在」是同一类传输层语义，前端据此展示空/不存在页。
 *   - {@link #CANNOT_FOLLOW_SELF} 与 {@link #FOLLOW_LIMIT_EXCEEDED} 都是
 *     **业务规则拒绝**，走 HTTP 200 + 业务码（见 docs/design/p55-social.md §2）——
 *     它们不是传输层错误，也不该触发前端任何 401/403 分支。
 */
public enum UserErrorCode implements ErrorCode {

    USER_NOT_FOUND(40209, "用户不存在"),

    /** followerId == followeeId */
    CANNOT_FOLLOW_SELF(40210, "不能关注自己"),

    /** 超过单人关注上限（默认 200，可配置） */
    FOLLOW_LIMIT_EXCEEDED(40211, "关注人数已达上限");

    private final int code;
    private final String message;

    UserErrorCode(int code, String message) {
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
