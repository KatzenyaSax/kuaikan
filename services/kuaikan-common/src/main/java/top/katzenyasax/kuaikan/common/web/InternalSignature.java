package top.katzenyasax.kuaikan.common.web;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 网关 → 服务的内部身份签名。
 *
 * 签名对象是一个规范化字符串 userId|roles|timestamp，用 HMAC-SHA256 + 共享密钥。
 * 放在 kuaikan-common（零 Spring 依赖）里，是为了**签发方（网关，WebFlux）
 * 与验签方（7 个 servlet 服务）用同一份实现**，避免两处各写一遍导致格式不一致。
 *
 * 这不是凭证签名（那是 JWT 的职责），而是"这段 header 确实是网关写的"证明。
 */
public final class InternalSignature {

    private static final String ALGORITHM = "HmacSHA256";

    /** 时间戳容差：超过这个窗口的签名视为重放 */
    public static final long MAX_CLOCK_SKEW_SECONDS = 60;

    public static String payload(String userId, String roles, long timestampSeconds) {
        return userId + "|" + roles + "|" + timestampSeconds;
    }

    public static String sign(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("计算内部签名失败", e);
        }
    }

    /** 常量时间比较，避免通过响应耗时逐字节猜签名 */
    public static boolean verify(String secret, String payload, String presented) {
        if (secret == null || secret.isBlank() || presented == null) {
            return false;
        }
        String expected = sign(secret, payload);
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                presented.trim().toLowerCase().getBytes(StandardCharsets.UTF_8));
    }

    public static long nowSeconds() {
        return System.currentTimeMillis() / 1000L;
    }

    private InternalSignature() {
    }
}
