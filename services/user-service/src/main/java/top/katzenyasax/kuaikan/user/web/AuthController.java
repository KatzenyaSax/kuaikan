package top.katzenyasax.kuaikan.user.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.user.auth.LoginService;
import top.katzenyasax.kuaikan.user.auth.ProfileService;
import top.katzenyasax.kuaikan.user.auth.RegistrationService;
import top.katzenyasax.kuaikan.user.auth.SessionService;
import top.katzenyasax.kuaikan.user.auth.TokenService;
import top.katzenyasax.kuaikan.user.domain.RefreshToken;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.web.dto.LoginRequest;
import top.katzenyasax.kuaikan.user.web.dto.LoginResponse;
import top.katzenyasax.kuaikan.user.web.dto.RegisterRequest;
import top.katzenyasax.kuaikan.user.web.dto.RegisterResponse;
import top.katzenyasax.kuaikan.user.web.dto.SendCodeRequest;
import top.katzenyasax.kuaikan.user.web.dto.SessionItem;
import top.katzenyasax.kuaikan.user.web.dto.UpdateProfileRequest;
import top.katzenyasax.kuaikan.user.web.dto.UserProfile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegistrationService registrationService;
    private final LoginService loginService;
    private final SessionService sessionService;
    private final ProfileService profileService;

    public AuthController(RegistrationService registrationService,
                          LoginService loginService,
                          SessionService sessionService,
                          ProfileService profileService) {
        this.registrationService = registrationService;
        this.loginService = loginService;
        this.sessionService = sessionService;
        this.profileService = profileService;
    }

    /** 发送注册验证码 */
    @PublicEndpoint
    @PostMapping("/register/code")
    public Result<Map<String, Object>> sendRegisterCode(@Valid @RequestBody SendCodeRequest body,
                                                        HttpServletRequest request) {
        registrationService.sendCode(body.email(), clientIp(request));
        return Result.ok(Map.of(
                "sent", true,
                "message", "验证码已发送，请查收邮箱",
                "ttlSeconds", 600
        ));
    }

    /** 注册 */
    @PublicEndpoint
    @PostMapping("/register")
    public Result<RegisterResponse> register(@Valid @RequestBody RegisterRequest body) {
        return Result.ok(registrationService.register(body));
    }

    // ---------------------------------------------------------------- 登录

    /**
     * 登录。
     *
     * 凭据错误返回 200 + 40206（不是 401）：401 会让前端的续期拦截器介入，
     * 变成"输错密码 → 跳登录页"的死循环。见 p1-auth.md §4。
     */
    @PublicEndpoint
    @PostMapping("/login")
    public ResponseEntity<Result<LoginResponse>> login(@Valid @RequestBody LoginRequest body,
                                                       HttpServletRequest request) {
        LoginService.TokenPair pair = loginService.login(
                body.email(), body.password(), request.getHeader(HttpHeaders.USER_AGENT),
                clientIp(request));
        LoginResponse payload = LoginResponse.of(pair.accessToken(), pair.expiresInSeconds(),
                UserProfile.of(pair.user()));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        AuthCookies.refresh(pair.refreshToken(), TokenService.REFRESH_TTL).toString())
                .body(Result.ok(payload));
    }

    /** 续期。refresh 从 httpOnly cookie 读，JS 拿不到它 */
    @PublicEndpoint
    @PostMapping("/refresh")
    public ResponseEntity<Result<LoginResponse>> refresh(
            @CookieValue(value = AuthCookies.REFRESH, required = false) String refreshToken,
            HttpServletRequest request) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        LoginService.TokenPair pair = loginService.refresh(
                refreshToken, request.getHeader(HttpHeaders.USER_AGENT), clientIp(request));
        LoginResponse payload = LoginResponse.of(pair.accessToken(), pair.expiresInSeconds(),
                UserProfile.of(pair.user()));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        AuthCookies.refresh(pair.refreshToken(), TokenService.REFRESH_TTL).toString())
                .body(Result.ok(payload));
    }

    /** 登出。幂等：refresh 已失效也返回成功 */
    @PostMapping("/logout")
    public ResponseEntity<Result<Void>> logout(
            @CookieValue(value = AuthCookies.REFRESH, required = false) String refreshToken,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        String accessToken = BearerTokens.extract(authorization);
        loginService.logout(refreshToken, accessToken == null ? null : loginService.accessJtiOf(accessToken));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, AuthCookies.clear().toString())
                .body(Result.ok());
    }

    // ---------------------------------------------------------------- 当前用户

    @GetMapping("/me")
    public Result<UserProfile> me() {
        User user = currentUser();
        return Result.ok(UserProfile.of(user));
    }

    /** 修改自己的资料（昵称 / 头像）。目标用户来自 UserContext，不接受调用方传 userId */
    @PatchMapping("/me")
    public Result<UserProfile> updateProfile(@Valid @RequestBody UpdateProfileRequest body) {
        Long userId = UserContext.requireUserId();
        return Result.ok(profileService.update(userId, body));
    }

    @GetMapping("/sessions")
    public Result<List<SessionItem>> sessions() {
        User user = currentUser();
        List<RefreshToken> rows = sessionService.activeSessions(user.getId());
        List<SessionItem> items = rows.stream()
                .map(r -> new SessionItem(r.getJti(), r.getUserAgent(), r.getIp(),
                        r.getIssuedAt(), r.getExpiresAt(), false))
                .toList();
        return Result.ok(items);
    }

    /** 踢掉某一个设备（产品语义：用户自己管理登录设备） */
    @DeleteMapping("/sessions/{jti}")
    public Result<Map<String, Object>> revokeSession(@PathVariable("jti") String jti) {
        User user = currentUser();
        RefreshToken target = sessionService.findByJti(jti);
        // 只能删自己的会话；别人的 jti 一律当作不存在，不暴露其是否存在
        if (target == null || !target.getUserId().equals(user.getId())) {
            throw new BizException(CommonErrorCode.NOT_FOUND);
        }
        sessionService.revokeOne(jti);
        return Result.ok(Map.of("revoked", jti));
    }

    /**
     * 当前用户。
     *
     * P1.3 起身份由网关注入（P1.2 时是本服务自己验 token）。
     * 这里仍然回查一次数据库：网关的白名单只保证"凭证未被撤销"，
     * 不保证"账号此刻仍可用"——封禁是在 DB 里改状态，属于另一条路径。
     */
    private User currentUser() {
        Long userId = UserContext.requireUserId();
        return loginService.requireActiveUser(userId);
    }

    /**
     * 取真实客户端 IP。
     *
     * 请求经网关转发，X-Forwarded-For 的第一个值是客户端 IP。
     * P1 只用它做验证码发送频率限制——即使被伪造，代价也只是"换个 IP 再发一次"，
     * 不值得为它引入可信代理链校验。
     */
    private String clientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        return request.getRemoteAddr();
    }
}
