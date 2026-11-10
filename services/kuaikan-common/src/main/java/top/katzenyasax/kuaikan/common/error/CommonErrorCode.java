package top.katzenyasax.kuaikan.common.error;

/**
 * 跨服务通用的错误码。
 *
 * 唯一事实来源是 contract/error-codes.json —— 改这里必须同步改 JSON，
 * 并由 `node deploy/bin/check-contract.mjs` 校验。
 * 身份相关错误码见 {@link AuthErrorCode}。
 */
public enum CommonErrorCode implements ErrorCode {

    BAD_REQUEST(40000, "请求参数不合法"),
    /** 字段级校验失败，前端需要定位到具体表单字段 */
    PARAM_INVALID(40010, "字段校验未通过"),
    UNAUTHORIZED(40100, "未登录或登录已过期"),
    FORBIDDEN(40300, "没有权限"),
    NOT_FOUND(40400, "资源不存在"),
    CONFLICT(40900, "状态冲突"),
    RATE_LIMITED(42900, "请求过于频繁"),
    INTERNAL(50000, "服务内部错误"),
    UPSTREAM_UNAVAILABLE(50300, "服务暂时不可用");

    private final int code;
    private final String message;

    CommonErrorCode(int code, String message) {
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
