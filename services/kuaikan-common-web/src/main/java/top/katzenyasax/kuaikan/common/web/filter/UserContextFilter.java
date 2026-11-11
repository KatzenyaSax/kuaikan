package top.katzenyasax.kuaikan.common.web.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.common.web.InternalSignature;
import top.katzenyasax.kuaikan.common.web.UserContext;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 把网关注入的身份放进 {@link UserContext}。
 *
 * **验的是"这段 header 确实是网关写的"，不是验用户凭证**——用户凭证由网关验签。
 * 这里用 HMAC 共享密钥 + 时间戳窗口，而不是再验一次 JWT，理由是：
 *   - 不需要每个服务都拉 JWKS、都实现 RS256 验签（那会把"单点验签"的好处全吐回去）
 *   - 只回答一个问题："这个 X-User-Id 是网关写的吗"
 *
 * 没有 X-User-Id 的请求视为**匿名**，正常放行（例如服务间不带身份的调用）。
 *
 * ThreadLocal 必须在 finally 里 clear：线程池复用会把上一个请求的身份带给下一个请求，
 * 那是只在并发下偶发的越权事故。
 */
public class UserContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(UserContextFilter.class);

    private final String internalSecret;

    public UserContextFilter(String internalSecret) {
        this.internalSecret = internalSecret;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String userId = request.getHeader(Headers.USER_ID);
            if (userId == null || userId.isBlank()) {
                // 匿名请求：没有身份，也没有签名，直接放行
                filterChain.doFilter(request, response);
                return;
            }

            String rejection = verifySignature(request, userId);
            if (rejection != null) {
                log.warn("内部签名校验失败：{} path={} remote={} userId={}",
                        rejection, request.getRequestURI(), request.getRemoteAddr(), userId);
                writeUnauthorized(response);
                return;
            }

            String roles = request.getHeader(Headers.USER_ROLES);
            UserContext.set(parseLong(userId), roles);
            filterChain.doFilter(request, response);
        } finally {
            UserContext.clear();
        }
    }

    /** @return null 表示通过 */
    private String verifySignature(HttpServletRequest request, String userId) {
        if (internalSecret == null || internalSecret.isBlank()) {
            // 配置缺失属于部署错误，不能静默降级成"不校验"
            return "未配置内部签名密钥";
        }

        String signature = request.getHeader(Headers.INTERNAL_SIGNATURE);
        String timestamp = request.getHeader(Headers.INTERNAL_TIMESTAMP);
        if (signature == null || timestamp == null) {
            return "缺少签名或时间戳";
        }

        long ts;
        try {
            ts = Long.parseLong(timestamp.trim());
        } catch (NumberFormatException e) {
            return "时间戳格式错误";
        }

        long skew = Math.abs(InternalSignature.nowSeconds() - ts);
        if (skew > InternalSignature.MAX_CLOCK_SKEW_SECONDS) {
            // 防重放：过一个小时再用同一个签名无效
            return "时间戳超出容差 " + skew + "s";
        }

        String roles = request.getHeader(Headers.USER_ROLES);
        String payload = InternalSignature.payload(userId, roles, ts);
        if (!InternalSignature.verify(internalSecret, payload, signature)) {
            return "签名不匹配";
        }
        return null;
    }

    private void writeUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"code\":" + CommonErrorCode.UNAUTHORIZED.code()
                + ",\"message\":\"" + CommonErrorCode.UNAUTHORIZED.message() + "\",\"data\":null}");
    }

    private Long parseLong(String value) {
        try {
            return Long.valueOf(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
