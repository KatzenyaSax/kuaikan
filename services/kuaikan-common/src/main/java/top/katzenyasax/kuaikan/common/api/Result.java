package top.katzenyasax.kuaikan.common.api;

import top.katzenyasax.kuaikan.common.error.ErrorCode;

/**
 * 统一响应体。code 为 0 表示成功。
 */
public record Result<T>(int code, String message, T data) {

    public static final int SUCCESS_CODE = 0;

    public static <T> Result<T> ok(T data) {
        return new Result<>(SUCCESS_CODE, "ok", data);
    }

    public static Result<Void> ok() {
        return new Result<>(SUCCESS_CODE, "ok", null);
    }

    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
    }

    public static <T> Result<T> fail(ErrorCode errorCode) {
        return new Result<>(errorCode.code(), errorCode.message(), null);
    }
}
