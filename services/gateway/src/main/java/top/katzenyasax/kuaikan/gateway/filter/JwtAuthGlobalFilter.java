package top.katzenyasax.kuaikan.gateway.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.gateway.auth.AccessWhitelist;
import top.katzenyasax.kuaikan.gateway.auth.JwksProvider;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;

/**
 * 身份的**唯一信任源**。
 *
 * 做六件事，顺序不能改：
 *   1. 命中白名单 → 直接放行
 *   2. 取 Authorization: Bearer → 没有则 401
 *   3. 用 JWKS 公钥验 RS256 签名 → 失败则 401
 *   4. 校验 exp / iss / typ → 失败则 401
 *   5. 查 Redis 白名单 auth:session:{jti} → 不存在则 401
 *   6. **先剥离**客户端的 X-User-Id / X-User-Roles，**再注入**从 token 解出的真身份
 *
 * 第 6 步是整个 P1 最关键的两行。写反了要么丢身份（下游全变匿名），
 * 要么留后门（客户端可以自带 X-User-Id 冒充任意用户）。
 * 验收里有一条专门钉死它：带合法 token + 伪造头 → 必须返回自己的 id。
 *
 * 依赖不可用时 fail-closed（503），绝不放行。
 */
@Component
public class JwtAuthGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthGlobalFilter.class);
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String ISSUER = "kuaikan";
    private static final String ACCESS_TYPE = "access";

    private final JwksProvider jwksProvider;
    private final AccessWhitelist whitelist;
    private final ObjectMapper objectMapper;
    private final List<String> exactWhitelist;
    private final List<String> patternWhitelist;

    public JwtAuthGlobalFilter(
            JwksProvider jwksProvider,
            AccessWhitelist whitelist,
            ObjectMapper objectMapper,
            @Value("${kuaikan.auth.whitelist:}") List<String> exactWhitelist,
            @Value("${kuaikan.auth.public-patterns:}") List<String> patternWhitelist) {
        this.jwksProvider = jwksProvider;
        this.whitelist = whitelist;
        this.objectMapper = objectMapper;
        this.exactWhitelist = exactWhitelist;
        this.patternWhitelist = patternWhitelist;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        if (isPublic(path)) {
            // 放行也要做一件小事：把客户端伪造的身份头剥掉。
            // 否则匿名请求带着 X-User-Id: 999 打到下游，下游会当成已登录。
            return chain.filter(withStrippedIdentity(exchange));
        }

        String token = bearerToken(exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION));
        if (token == null) {
            return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
        }

        SignedJWT jwt;
        try {
            jwt = SignedJWT.parse(token);
        } catch (Exception e) {
            return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
        }

        String kid = jwt.getHeader().getKeyID();
        return jwksProvider.keyFor(kid)
                .switchIfEmpty(Mono.defer(() -> {
                    log.warn("未知 kid={}，可能是密钥不匹配", kid);
                    return Mono.empty();
                }))
                .flatMap(rsaKey -> {
                    try {
                        if (!jwt.verify(new RSASSAVerifier(rsaKey))) {
                            return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
                        }
                        JWTClaimsSet claims = jwt.getJWTClaimsSet();
                        String problem = validate(claims);
                        if (problem != null) {
                            log.info("token 校验未通过：{} path={}", problem, path);
                            return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
                        }
                        String jti = claims.getJWTID();
                        return whitelist.isActive(jti).flatMap(active -> {
                            if (!Boolean.TRUE.equals(active)) {
                                // 已登出 / 被踢下线 / 被封禁
                                return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
                            }
                            return chain.filter(withIdentity(exchange, claims));
                        });
                    } catch (Exception e) {
                        log.warn("token 验签异常 path={} err={}", path, e.toString());
                        return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message());
                    }
                })
                .onErrorResume(e -> {
                    // 取不到公钥 / Redis 不可用 —— 安全路径必须 fail-closed
                    log.error("鉴权依赖不可用，拒绝请求 path={} err={}", path, e.toString());
                    return failClosed(exchange);
                });
    }

    /** @return null 表示通过，否则是原因 */
    private String validate(JWTClaimsSet claims) {
        Date exp = claims.getExpirationTime();
        if (exp == null || exp.toInstant().isBefore(Instant.now())) {
            return "expired";
        }
        if (!ISSUER.equals(claims.getIssuer())) {
            return "issuer mismatch";
        }
        Object typ = claims.getClaim("typ");
        if (!ACCESS_TYPE.equals(typ)) {
            // 防止拿 refresh（30 天）当 access 用
            return "typ=" + String.valueOf(typ);
        }
        if (claims.getJWTID() == null || claims.getSubject() == null) {
            return "missing jti/sub";
        }
        return null;
    }

    private boolean isPublic(String path) {
        for (String allowed : exactWhitelist) {
            if (allowed != null && allowed.equals(path)) {
                return true;
            }
        }
        for (String pattern : patternWhitelist) {
            if (pattern != null && !pattern.isBlank() && path.matches(pattern)) {
                return true;
            }
        }
        return false;
    }

    /** 放行分支：只剥离，不注入 */
    private ServerWebExchange withStrippedIdentity(ServerWebExchange exchange) {
        ServerHttpRequest mutated = exchange.getRequest().mutate()
                .headers(h -> {
                    h.remove(Headers.USER_ID);
                    h.remove(Headers.USER_ROLES);
                })
                .build();
        return exchange.mutate().request(mutated).build();
    }

    /**
     * 认证分支：**先 remove 再 set**。
     *
     * 顺序反过来就是漏洞——客户端可以自带 X-User-Id，而我们的 set 如果没有
     * 覆盖掉它（或用 add 追加），下游读到的可能是伪造值。
     */
    private ServerWebExchange withIdentity(ServerWebExchange exchange, JWTClaimsSet claims) {
        String userId = claims.getSubject();
        String roles = String.valueOf(claims.getClaim("roles"));
        String jti = claims.getJWTID();

        ServerHttpRequest mutated = exchange.getRequest().mutate()
                .headers(h -> {
                    h.remove(Headers.USER_ID);
                    h.remove(Headers.USER_ROLES);
                    h.set(Headers.USER_ID, userId);
                    h.set(Headers.USER_ROLES, roles);
                    if (jti != null) {
                        h.set("X-Access-Jti", jti);
                    }
                })
                .build();
        return exchange.mutate().request(mutated).build();
    }

    private String bearerToken(String authorization) {
        if (authorization == null || authorization.length() <= BEARER_PREFIX.length()) {
            return null;
        }
        if (!authorization.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return null;
        }
        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    private Mono<Void> unauthorized(ServerWebExchange exchange, String message) {
        return writeJson(exchange, HttpStatus.UNAUTHORIZED,
                Result.fail(CommonErrorCode.UNAUTHORIZED.code(), message));
    }

    private Mono<Void> failClosed(ServerWebExchange exchange) {
        return writeJson(exchange, HttpStatus.SERVICE_UNAVAILABLE,
                Result.fail(CommonErrorCode.UPSTREAM_UNAVAILABLE));
    }

    private Mono<Void> writeJson(ServerWebExchange exchange, HttpStatus status, Result<?> body) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes;
        try {
            bytes = objectMapper.writeValueAsBytes(body);
        } catch (Exception e) {
            bytes = ("{\\"code\\":" + CommonErrorCode.INTERNAL.code() + "}").getBytes(StandardCharsets.UTF_8);
        }
        DataBuffer buffer = response.bufferFactory().wrap(bytes);
        return response.writeWith(Mono.just(buffer));
    }

    /**
     * 晚于 InternalPathBlockFilter（-100），早于路由转发（RouteToRequestUrlFilter 10000）。
     * 顺序：先拦 /internal/**，再验身份。
     */
    @Override
    public int getOrder() {
        return -90;
    }
}
