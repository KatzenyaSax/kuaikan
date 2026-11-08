package top.katzenyasax.kuaikan.common.error;

/**
 * 业务异常。由统一异常处理器转换为 Result。
 */
public class BizException extends RuntimeException {

    private final int code;

    public BizException(ErrorCode errorCode) {
        super(errorCode.message());
        this.code = errorCode.code();
    }

    public BizException(ErrorCode errorCode, String message) {
        super(message);
        this.code = errorCode.code();
    }

    public int code() {
        return code;
    }
}
