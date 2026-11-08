package top.katzenyasax.kuaikan.common.error;

/**
 * 错误码契约。各服务用枚举实现，code 一经发布不得变更含义。
 */
public interface ErrorCode {

    int code();

    String message();
}
