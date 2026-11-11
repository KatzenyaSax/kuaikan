package top.katzenyasax.kuaikan.user.auth;

/**
 * Redis 键的唯一构造入口。
 *
 * 禁止在业务代码里拼字符串——散落的拼接是键漂移的唯一来源，
 * 而键一旦对不上，表现是"功能时好时坏"，最难排查。
 */
public final class AuthKeys {

    private static final String PREFIX = "auth:";

    /** 验证码正文：auth:code:register:{email} */
    public static String code(String scene, String email) {
        return PREFIX + "code:" + scene + ":" + email;
    }

    /** 验证码错误次数：auth:code:try:register:{email} */
    public static String codeAttempts(String scene, String email) {
        return PREFIX + "code:try:" + scene + ":" + email;
    }

    /** 同邮箱发送频率：auth:code:rate:email:{email} */
    public static String rateByEmail(String email) {
        return PREFIX + "code:rate:email:" + email;
    }

    /** 同 IP 发送频率：auth:code:rate:ip:{ip} */
    public static String rateByIp(String ip) {
        return PREFIX + "code:rate:ip:" + ip;
    }

    /** access 白名单：auth:session:{jti} → userId（网关 P1.3 查它） */
    public static String session(String jti) {
        return PREFIX + "session:" + jti;
    }

    /**
     * 该用户仍有效的 access jti：auth:user:{userId}:access
     *
     * **ZSet 而不是 Set**：member=jti，score=access 的过期时间戳（epoch 秒）。
     * Set 的成员没有独立 TTL，只有整个 key 有，导致过期的 jti 永远留在集合里、
     * 而每次写入又把 key 的 TTL 重置回 30 天 —— 集合只增不减。
     * 换成 ZSet 后可以按 score 精确剔除已过期的成员。
     */
    public static String userAccessJtis(Long userId) {
        return PREFIX + "user:" + userId + ":access";
    }

    private AuthKeys() {
    }
}
