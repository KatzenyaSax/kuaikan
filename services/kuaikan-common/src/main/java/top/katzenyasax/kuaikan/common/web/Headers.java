package top.katzenyasax.kuaikan.common.web;

/**
 * 网关向下游注入的请求头。下游服务不再解析 JWT（见 ADR 0003）。
 */
public final class Headers {

    public static final String USER_ID = "X-User-Id";
    public static final String USER_ROLES = "X-User-Roles";
    public static final String TRACE_ID = "X-Trace-Id";

    private Headers() {
    }
}
