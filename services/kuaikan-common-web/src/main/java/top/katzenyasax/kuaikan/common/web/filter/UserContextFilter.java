package top.katzenyasax.kuaikan.common.web.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.common.web.UserContext;

import java.io.IOException;

/**
 * 把网关注入的身份放进 {@link UserContext}。
 *
 * 这里**只读 header，不验签、不校验签名**：网关是唯一信任源（ADR 0003）。
 * 前提是所有服务端口都不对公网暴露 —— 由 compose 不声明 ports、UFW、
 * 以及 verify.sh 的配置层断言共同保证。
 *
 * 没有 X-User-Id 的请求视为匿名，正常放行。
 *
 * ThreadLocal 必须在 finally 里 clear：线程池复用会把上一个请求的身份带给下一个，
 * 那是只在并发下偶发的越权事故。
 */
public class UserContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String userId = request.getHeader(Headers.USER_ID);
            if (userId != null && !userId.isBlank()) {
                UserContext.set(parseLong(userId), request.getHeader(Headers.USER_ROLES));
            }
            filterChain.doFilter(request, response);
        } finally {
            UserContext.clear();
        }
    }

    private Long parseLong(String value) {
        try {
            return Long.valueOf(value.trim());
        } catch (NumberFormatException e) {
            // 网关注入的一定是合法数字；走到这里说明有人绕过了网关，按未认证处理
            return null;
        }
    }
}
