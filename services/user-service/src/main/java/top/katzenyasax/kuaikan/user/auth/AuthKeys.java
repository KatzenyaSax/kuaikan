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

    /** 用户全部 access jti 集合：auth:user:{userId}:jti（踢下线时批量删） */
    public static String userJtiSet(Long userId) {
        return PREFIX + "user:" + userId + ":jti";
    }

    private AuthKeys() {
    }
}
