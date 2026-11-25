package top.katzenyasax.kuaikan.common.web;

/**
 * 网关向下游注入的请求头。下游服务不再解析 JWT（见 ADR 0003）。
 *
 * 网关是唯一信任源，它剥离客户端传来的同名头后注入真身份。
 * 这里刻意**没有**内部签名头 —— 我们评估过要不要给 header 加 HMAC 签名，
 * 结论是不做，理由见 ADR 0008。
 *
 * {@link #TOKEN_EXP} 是 P4.2 加的：SSE 长连接建立后网关不再校验 token，
 * 连接可以活得比 token 更久。notification 需要知道确切的过期时刻，
 * 才能在 token 失效时主动断流，而不是留下一个"还连着但已经无主"的连接。
 * 让服务层自己去解析 JWT 是更差的选择——那等于开了第二个验签点（违反 ADR 0003）。
 */
public final class Headers {

    public static final String USER_ID = "X-User-Id";
    public static final String USER_ROLES = "X-User-Roles";
    public static final String TRACE_ID = "X-Trace-Id";

    /** access token 的过期时刻，epoch 秒。只在需要长连接的场景有意义 */
    public static final String TOKEN_EXP = "X-Token-Exp";

    /** AI 测试 Stub 场景头，仅内网直连且 stub-enabled=true 时生效，网关必须剥离 */
    public static final String AI_STUB = "X-AI-Stub";

    private Headers() {
    }
}
