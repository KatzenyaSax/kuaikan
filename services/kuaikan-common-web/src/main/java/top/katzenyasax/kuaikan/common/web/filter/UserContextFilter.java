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
 * 把网关注入的身份放进口 {@link UserContext}，请求结束必须 clear()。
 *
 * 这里**只读 header，不验签**：验签是网关的职责，下游无条件信任
 * 网关注入的 X-User-Id（ADR 0003）。前提是所有服务端口都不对公网暴露 ——
 * 这一点由 compose 不发布端口 + UFW 保证，不是靠"记得别暴露"。
 *
 * ThreadLocal 必须 clear，否则线程池复用会把上一个请求的身份带给下一个请求——
 * 那是典型的越权事故，而且只在并发下偶发。
 */
public class UserContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String userId = request.getHeader(Headers.USER_ID);
            String roles = request.getHeader(Headers.USER_ROLES);
            if (userId != null && !userId.isBlank()) {
                UserContext.set(parseLong(userId), roles);
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
