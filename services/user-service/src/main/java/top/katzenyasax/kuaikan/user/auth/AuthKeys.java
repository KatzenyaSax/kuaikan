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

    private AuthKeys() {
    }
}
