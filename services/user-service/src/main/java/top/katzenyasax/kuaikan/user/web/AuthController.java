package top.katzenyasax.kuaikan.user.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.user.auth.RegistrationService;
import top.katzenyasax.kuaikan.user.web.dto.RegisterRequest;
import top.katzenyasax.kuaikan.user.web.dto.RegisterResponse;
import top.katzenyasax.kuaikan.user.web.dto.SendCodeRequest;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegistrationService registrationService;

    public AuthController(RegistrationService registrationService) {
        this.registrationService = registrationService;
    }

    /** 发送注册验证码 */
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
    @PostMapping("/register")
    public Result<RegisterResponse> register(@Valid @RequestBody RegisterRequest body) {
        return Result.ok(registrationService.register(body));
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
