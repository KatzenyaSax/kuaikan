package top.katzenyasax.kuaikan.common.web;

/**
 * 网关向下游注入的请求头。下游服务不再解析 JWT（见 ADR 0003）。
 *
 * 只有这两个：网关是唯一信任源，它剥离客户端传来的同名头后注入真身份。
 * 这里刻意**没有**内部签名头 —— 我们评估过要不要给 header 加 HMAC 签名，
 * 结论是不做，理由见 ADR 0008。
 */
public final class Headers {

    public static final String USER_ID = "X-User-Id";
    public static final String USER_ROLES = "X-User-Roles";
    public static final String TRACE_ID = "X-Trace-Id";

    private Headers() {
    }
}
