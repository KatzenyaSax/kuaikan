package top.katzenyasax.kuaikan.user.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import top.katzenyasax.kuaikan.common.error.AuthErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.user.config.AuthProperties;

import java.security.SecureRandom;
import java.time.Duration;

/**
 * 邮箱验证码：生成、限流、校验。
 *
 * 存储选择：只放 Redis，不落库。
 *   - 生命周期只有 10 分钟，落库要配清理任务，收益为零
 *   - 明文存储：6 位数字 + 10 分钟 TTL + 绑定邮箱，泄漏后的可用窗口极小；
 *     为它做哈希属于过度设计，还会让"重发时校验"变复杂
 */
@Service
public class VerificationCodeService {

    private static final Logger log = LoggerFactory.getLogger(VerificationCodeService.class);
    private static final String SCENE_REGISTER = "register";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;
    private final AuthProperties props;

    public VerificationCodeService(StringRedisTemplate redis, AuthProperties props) {
        this.redis = redis;
        this.props = props;
    }

    /**
     * 生成并写入新验证码。
     *
     * 重发会**覆盖旧码并清零错误计数**——否则"重发一次但错误计数还在"
     * 会让用户永远用不了。
     */
    public String issueRegisterCode(String email, String ip) {
        // 同邮箱 60 秒一次
        Boolean first = redis.opsForValue()
                .setIfAbsent(AuthKeys.rateByEmail(email), "1", props.getCodeResendInterval());
        if (!Boolean.TRUE.equals(first)) {
            throw new BizException(AuthErrorCode.CODE_TOO_FREQUENT);
        }

        // 同 IP 每小时上限
        String ipKey = AuthKeys.rateByIp(ip);
        Long ipCount = redis.opsForValue().increment(ipKey);
        if (ipCount != null && ipCount == 1L) {
            redis.expire(ipKey, Duration.ofHours(1));
        }
        if (ipCount != null && ipCount > props.getCodeIpHourlyLimit()) {
            throw new BizException(AuthErrorCode.CODE_TOO_FREQUENT);
        }

        String code = randomDigits(props.getCodeLength());
        redis.opsForValue().set(AuthKeys.code(SCENE_REGISTER, email), code, props.getCodeTtl());
        redis.delete(AuthKeys.codeAttempts(SCENE_REGISTER, email));

        log.info("生成注册验证码 email={} codeLength={}", maskEmail(email), code.length());
        return code;
    }

    /**
     * 校验并消费验证码。成功即删除（一次性）。
     */
    public void consumeRegisterCode(String email, String code) {
        String key = AuthKeys.code(SCENE_REGISTER, email);
        String expected = redis.opsForValue().get(key);
        if (expected == null) {
            throw new BizException(AuthErrorCode.CODE_INVALID);
        }

        String tryKey = AuthKeys.codeAttempts(SCENE_REGISTER, email);
        if (!expected.equals(code)) {
            Long attempts = redis.opsForValue().increment(tryKey);
            if (attempts != null && attempts == 1L) {
                redis.expire(tryKey, props.getCodeTtl());
            }
            if (attempts != null && attempts >= props.getCodeMaxAttempts()) {
                // 试错次数用尽：作废验证码，必须重新发送
                redis.delete(key);
                redis.delete(tryKey);
                log.warn("验证码试错次数用尽，已作废 email={}", maskEmail(email));
            }
            throw new BizException(AuthErrorCode.CODE_INVALID);
        }

        redis.delete(key);
        redis.delete(tryKey);
    }

    private String randomDigits(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(RANDOM.nextInt(10));
        }
        return sb.toString();
    }

    /** 日志里不打完整邮箱 */
    private String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
