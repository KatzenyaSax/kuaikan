package top.katzenyasax.kuaikan.common.error;

/**
 * 跨服务通用的错误码。业务错误码由各服务自行定义在 1xxxx ~ 9xxxx 区间。
 */
public enum CommonErrorCode implements ErrorCode {

    BAD_REQUEST(40000, "请求参数不合法"),
    UNAUTHORIZED(40100, "未登录或登录已过期"),
    FORBIDDEN(40300, "没有权限"),
    NOT_FOUND(40400, "资源不存在"),
    CONFLICT(40900, "状态冲突"),
    RATE_LIMITED(42900, "请求过于频繁"),
    INTERNAL(50000, "服务内部错误"),
    UPSTREAM_UNAVAILABLE(50300, "下游服务不可用");

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
