package top.katzenyasax.kuaikan.common.error;

/**
 * 身份与账号相关的错误码。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验，否则 P1 的 L0 层会红。
 *
 * 关键约定（见 docs/design/p1-auth.md §4）：
 *   - CREDENTIALS_INVALID 走 HTTP 200 + 业务码，**不能是 401**。
 *     因为前端 401 拦截器会去调 refresh，登录失败返回 401 会形成
 *     "输错密码 → 跳登录页" 的死循环。
 *   - 邮箱不存在与密码错误必须返回完全相同的响应，防止用户枚举。
 */
public enum AuthErrorCode implements ErrorCode {

    CODE_INVALID(40201, "验证码错误或已失效"),
    CODE_TOO_FREQUENT(40202, "验证码发送过于频繁，请稍后再试"),
    REGISTER_DISABLED(40203, "注册功能暂未开放"),
    EMAIL_TAKEN(40204, "该邮箱已被注册"),
    ACCOUNT_BANNED(40205, "账号已被封禁"),
    CREDENTIALS_INVALID(40206, "邮箱或密码错误");

    private final int code;
    private final String message;

    AuthErrorCode(int code, String message) {
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
