package top.katzenyasax.kuaikan.common.web;

/**
 * 网关向下游注入的请求头。下游服务不再解析 JWT（见 ADR 0003）。
 */
public final class Headers {

    public static final String USER_ID = "X-User-Id";
    public static final String USER_ROLES = "X-User-Roles";
    public static final String TRACE_ID = "X-Trace-Id";

    /**
     * 网关对身份的 HMAC 签名与时间戳。
     *
     * 存在的理由：下游信任 X-User-Id 的前提是"只有网关能写它"，
     * 而这个前提仅靠网络隔离成立。一旦某个服务端口泄漏，
     * 任何人都能伪造 X-User-Id 冒充任意用户 —— 且是静默的。
     * 加上签名后，即使有人能直连服务，也伪造不出合法签名。
     */
    public static final String INTERNAL_SIGNATURE = "X-Internal-Signature";
    public static final String INTERNAL_TIMESTAMP = "X-Internal-Timestamp";

    private Headers() {
    }
}
