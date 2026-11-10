package top.katzenyasax.kuaikan.user.web;

import org.springframework.http.ResponseCookie;

import java.time.Duration;

/**
 * refresh cookie 的唯一构造入口。
 *
 * Path 收窄到 /api/user/auth 是有意的：其他任何接口都拿不到这个 cookie，泄漏面最小。
 * Secure 在 http://localhost 下浏览器仍会接受（localhost 被视为可信源），
 * 所以本地 Vite 代理开发不会被它挡死。
 */
public final class AuthCookies {

    public static final String REFRESH = "kuaikan_refresh";
    public static final String REFRESH_PATH = "/api/user/auth";

    public static ResponseCookie refresh(String value, Duration maxAge) {
        return ResponseCookie.from(REFRESH, value)
                .httpOnly(true)
                .secure(true)
                .sameSite("Lax")
                .path(REFRESH_PATH)
                .maxAge(maxAge)
                .build();
    }

    public static ResponseCookie clear() {
        return refresh("", Duration.ZERO);
    }

    private AuthCookies() {
    }
}
