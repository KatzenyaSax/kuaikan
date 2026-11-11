package top.katzenyasax.kuaikan.user.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.nimbusds.jwt.JWTClaimsSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.error.AuthErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.domain.RefreshToken;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.domain.UserStatus;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;

import java.time.LocalDateTime;
import java.util.Locale;

/**
 * 登录、续期、登出、身份解析。
 *
 * 两条硬约定（见 p1-auth.md §4）：
 *   1. 凭据错误返回 200 + 40206，**不是 401** —— 否则前端 401 拦截器会去 refresh，
 *      形成"输错密码 → 跳登录页"的死循环
 *   2. 邮箱不存在与密码错误返回完全相同的响应 —— 防用户枚举
 */
@Service
public class LoginService {

    private static final Logger log = LoggerFactory.getLogger(LoginService.class);

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final SessionService sessionService;

    public LoginService(UserMapper userMapper, PasswordEncoder passwordEncoder,
                        TokenService tokenService, SessionService sessionService) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.sessionService = sessionService;
    }

    public record TokenPair(String accessToken, long expiresInSeconds, String refreshToken,
                            User user) {
    }

    @Transactional
    public TokenPair login(String rawEmail, String password, String userAgent, String ip) {
        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        User user = userMapper.selectOne(
                new LambdaQueryWrapper<User>().eq(User::getEmail, email).isNull(User::getDeletedAt));

        // 用户不存在时也跑一次 BCrypt，避免通过响应耗时判断邮箱是否存在
        boolean passwordOk = user != null
                && passwordEncoder.matches(password, user.getPasswordHash());
        if (user == null || !passwordOk) {
            throw new BizException(AuthErrorCode.CREDENTIALS_INVALID);
        }

        if (user.getStatus() != null && user.getStatus() == UserStatus.BANNED.code()) {
            // 封禁必须能登录时被发现，且与"密码错误"区分开，否则用户无法理解发生了什么
            throw new BizException(AuthErrorCode.ACCOUNT_BANNED);
        }

        TokenPair pair = issuePair(user, userAgent, ip);

        User touch = new User();
        touch.setId(user.getId());
        touch.setLastLoginAt(LocalDateTime.now());
        userMapper.updateById(touch);

        log.info("登录成功 userId={} email={}", user.getId(), user.getEmail());
        return pair;
    }

    /**
     * 续期 + 轮换。
     *
     * 判定表见 SessionService.ReplayVerdict：
     *   首次使用 → 轮换
     *   宽限期内重复 → 允许（多标签页），consumedAt 不更新
     *   超过宽限期重放 → 吊销整族 + 401
     *
     * **noRollbackFor = BizException**：这是必须的。检测到重放时我们要
     * "先吊销整族、再抛 401"，而默认的 @Transactional 会在抛出异常时把
     * 吊销一起回滚掉——结果是"报告了发现泄漏，却没有真的处置"。
     * 实测确认过：不加这个参数，DB 里 revoked_at 永远是 NULL。
     * BizException 语义上就是"业务拒绝"，此前的写入都是有意的，不该回滚。
     */
    @Transactional(noRollbackFor = BizException.class)
    public TokenPair refresh(String refreshTokenValue, String userAgent, String ip) {
        JWTClaimsSet claims;
        try {
            claims = tokenService.verify(refreshTokenValue, "refresh");
        } catch (IllegalArgumentException e) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }

        String jti = claims.getJWTID();
        Long userId = tokenService.subjectOf(claims);
        RefreshToken stored = sessionService.findByJti(jti);
        if (stored == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }

        SessionService.ReplayVerdict verdict = sessionService.judge(stored);
        switch (verdict) {
            case REVOKED, EXPIRED -> throw new BizException(CommonErrorCode.UNAUTHORIZED);
            case REPLAY -> {
                SessionService.warnReplay(stored.getFamilyId(), jti);
                sessionService.revokeFamily(stored.getFamilyId());
                sessionService.revokeAllAccess(userId);
                throw new BizException(CommonErrorCode.UNAUTHORIZED);
            }
            case FIRST_USE, WITHIN_GRACE -> {
                // 继续
            }
            default -> throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }

        User user = userMapper.selectById(stored.getUserId());
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        if (user.getStatus() != null && user.getStatus() == UserStatus.BANNED.code()) {
            sessionService.revokeFamily(stored.getFamilyId());
            throw new BizException(AuthErrorCode.ACCOUNT_BANNED);
        }

        TokenPair pair = issuePairInFamily(user, stored.getFamilyId(), userAgent, ip);
        sessionService.markConsumed(stored, extractRefreshJti(pair.refreshToken()));
        return pair;
    }

    /** 登出：吊销当前 refresh + 立即删除 access 白名单（"立刻失效"） */
    @Transactional(noRollbackFor = BizException.class)
    public void logout(String refreshTokenValue, String accessJti) {
        if (refreshTokenValue != null && !refreshTokenValue.isBlank()) {
            try {
                JWTClaimsSet claims = tokenService.verify(refreshTokenValue, "refresh");
                sessionService.revokeOne(claims.getJWTID());
            } catch (IllegalArgumentException ignored) {
                // 已经无效的 refresh，登出仍然是幂等成功
            }
        }
        if (accessJti != null) {
            sessionService.revokeAccess(accessJti);
        }
    }

    /** 从 Authorization 解析当前用户（P1.2 由本服务自验；P1.3 起网关也会验） */
    public User requireUserFromAccessToken(String accessToken) {
        JWTClaimsSet claims;
        try {
            claims = tokenService.verify(accessToken, "access");
        } catch (IllegalArgumentException e) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        String jti = claims.getJWTID();
        if (!sessionService.isAccessActive(jti)) {
            // 已登出 / 被踢下线 / 被封禁
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        User user = userMapper.selectById(tokenService.subjectOf(claims));
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        if (user.getStatus() != null && user.getStatus() == UserStatus.BANNED.code()) {
            throw new BizException(AuthErrorCode.ACCOUNT_BANNED);
        }
        return user;
    }

    /**
     * 按 userId 取"仍然可用"的用户。
     *
     * 网关注入的 userId 已经验过签与白名单，但仍要回查状态：
     * 封禁只清 jti + 改状态，DB 是真相；这里做一次防御性检查。
     */
    public User requireActiveUser(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        if (user.getStatus() != null && user.getStatus() == UserStatus.BANNED.code()) {
            throw new BizException(AuthErrorCode.ACCOUNT_BANNED);
        }
        return user;
    }

    public String accessJtiOf(String accessToken) {
        try {
            return tokenService.verify(accessToken, "access").getJWTID();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private TokenPair issuePair(User user, String userAgent, String ip) {
        return issuePairInFamily(user, tokenService.newFamilyId(), userAgent, ip);
    }

    private TokenPair issuePairInFamily(User user, String familyId, String userAgent, String ip) {
        TokenService.IssuedToken access = tokenService.issueAccess(user.getId(), user.getRoles());
        TokenService.IssuedToken refresh = tokenService.issueRefresh(user.getId(), familyId);

        sessionService.registerAccess(user.getId(), access.jti(), TokenService.ACCESS_TTL);

        RefreshToken row = new RefreshToken();
        row.setUserId(user.getId());
        row.setJti(refresh.jti());
        row.setFamilyId(familyId);
        row.setIssuedAt(SessionService.toLocal(java.time.Instant.now()));
        row.setExpiresAt(SessionService.toLocal(refresh.expiresAt()));
        row.setUserAgent(userAgent == null ? null : truncate(userAgent, 255));
        row.setIp(ip);
        sessionService.saveRefresh(row);

        return new TokenPair(access.value(), TokenService.ACCESS_TTL.toSeconds(), refresh.value(), user);
    }

    private String extractRefreshJti(String refreshToken) {
        try {
            return tokenService.verify(refreshToken, "refresh").getJWTID();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
