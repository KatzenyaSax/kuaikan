package top.katzenyasax.kuaikan.user.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.error.AuthErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.user.config.AuthProperties;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.domain.UserStatus;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.RegisterRequest;
import top.katzenyasax.kuaikan.user.web.dto.RegisterResponse;

import java.util.Locale;

@Service
public class RegistrationService {

    private static final Logger log = LoggerFactory.getLogger(RegistrationService.class);
    private static final String DEFAULT_ROLES = "USER";

    private final AuthProperties props;
    private final VerificationCodeService codeService;
    private final VerificationMailService mailService;
    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;

    public RegistrationService(AuthProperties props,
                               VerificationCodeService codeService,
                               VerificationMailService mailService,
                               UserMapper userMapper,
                               PasswordEncoder passwordEncoder) {
        this.props = props;
        this.codeService = codeService;
        this.mailService = mailService;
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
    }

    /** 发送注册验证码 */
    public void sendCode(String rawEmail, String ip) {
        requireRegisterEnabled();
        String email = normalizeEmail(rawEmail);
        String code = codeService.issueRegisterCode(email, ip);
        mailService.sendRegisterCode(email, code);
    }

    /**
     * 注册。
     *
     * 顺序有意为之：**先校验验证码，再查邮箱是否已存在**。
     * 反过来的话，未持有验证码的人也能通过"是否已注册"的响应探测邮箱，
     * 等于把防用户枚举的目的绕过了。
     */
    @Transactional
    public RegisterResponse register(RegisterRequest request) {
        requireRegisterEnabled();

        String email = normalizeEmail(request.email());
        codeService.consumeRegisterCode(email, request.code());

        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setNickname(request.nickname().trim());
        user.setRoles(DEFAULT_ROLES);
        user.setStatus(UserStatus.NORMAL.code());

        try {
            userMapper.insert(user);
        } catch (DuplicateKeyException e) {
            // 唯一索引兜底并发：两个人同时用同一邮箱注册时，只有一个能成功
            throw new BizException(AuthErrorCode.EMAIL_TAKEN);
        }

        log.info("注册成功 userId={} email={}", user.getId(), maskEmail(email));
        return new RegisterResponse(user.getId(), user.getEmail(), user.getNickname(),
                user.getCreatedAt());
    }

    private void requireRegisterEnabled() {
        if (!props.isRegisterEnabled()) {
            throw new BizException(AuthErrorCode.REGISTER_DISABLED);
        }
    }

    /** 大小写统一在应用层做，不依赖 COLLATE（见 p1-storage.md） */
    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private String maskEmail(String email) {
        int at = email.indexOf('@');
        return at <= 1 ? "***" : email.charAt(0) + "***" + email.substring(at);
    }
}
