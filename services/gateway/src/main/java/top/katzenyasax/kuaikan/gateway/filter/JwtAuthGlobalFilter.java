package top.katzenyasax.kuaikan.gateway.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import java.util.Optional;

import reactor.core.publisher.Mono;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.Headers;
import top.katzenyasax.kuaikan.gateway.auth.AccessWhitelist;
import top.katzenyasax.kuaikan.gateway.auth.PublicEndpointRules;
import top.katzenyasax.kuaikan.gateway.auth.JwksProvider;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;

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
    private final PublicEndpointRules publicRules;

    public JwtAuthGlobalFilter(
            JwksProvider jwksProvider,
            AccessWhitelist whitelist,
            ObjectMapper objectMapper,
            PublicEndpointRules publicRules) {
        this.jwksProvider = jwksProvider;
        this.whitelist = whitelist;
        this.objectMapper = objectMapper;
        this.publicRules = publicRules;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        String method = exchange.getRequest().getMethod().name();

        // 放行判断必须带方法：同一路径常常读公开、写需要登录（如 /communities）
        if (publicRules.isPublic(method, path)) {
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

        SignedJWT parsed = jwt;
        return authenticate(exchange, parsed, path)
                .flatMap(claims -> claims.isPresent()
                        ? chain.filter(withIdentity(exchange, claims.get()))
                        : Mono.empty());
    }

    /**
     * 解析身份。返回 {@code Optional.empty()} 表示"已拒绝并写完响应"。
     *
     * <b>为什么下游调用必须在这一步之外</b>：
     * 原来的写法把 {@code chain.filter(...)} 也套在 {@code onErrorResume} 里，于是
     * 任何下游异常（例如负载均衡器报 "Unable to find instance for community-service"）
     * 都会被那条 catch 抓住，记成"鉴权依赖不可用"并替换成自己的 503 响应。
     *
     * 后果有两个：日志把"下游挂了"误导成"鉴权故障"，排查方向直接跑偏；
     * 而且下游的真实响应被吞掉了。现在 {@code chain.filter} 在 {@code flatMap}
     * 里调用，它的错误不会再进入这里的 {@code onErrorResume}。
     *
     * 这里的 {@code onErrorResume} 只覆盖两件事：取公钥、查 Redis 白名单。
     * 两者失败时都无法判断身份，所以必须 fail-closed。
     */
    private Mono<Optional<JWTClaimsSet>> authenticate(
            ServerWebExchange exchange, SignedJWT jwt, String path) {
        String kid = jwt.getHeader().getKeyID();
        return jwksProvider.keyFor(kid)
                .map(Optional::of)
                .defaultIfEmpty(Optional.empty())
                .flatMap(maybeKey -> {
                    if (maybeKey.isEmpty()) {
                        log.warn("未知 kid={}，可能是密钥不匹配", kid);
                        return reject(exchange);
                    }
                    try {
                        if (!jwt.verify(new RSASSAVerifier(maybeKey.get()))) {
                            return reject(exchange);
                        }
                        JWTClaimsSet claims = jwt.getJWTClaimsSet();
                        String problem = validate(claims);
                        if (problem != null) {
                            log.info("token 校验未通过：{} path={}", problem, path);
                            return reject(exchange);
                        }
                        // Redis 白名单是"登出/踢下线/封禁立即失效"的全部来源
                        return whitelist.isActive(claims.getJWTID())
                                .flatMap(active -> Boolean.TRUE.equals(active)
                                        ? Mono.just(Optional.of(claims))
                                        : reject(exchange));
                    } catch (Exception e) {
                        log.warn("token 验签异常 path={} err={}", path, e.toString());
                        return reject(exchange);
                    }
                })
                .onErrorResume(e -> {
                    // 只可能是"公钥或 Redis 不可用"——无法判断身份，fail-closed
                    log.error("鉴权依赖不可用，拒绝请求 path={} err={}", path, e.toString());
                    return failClosed(exchange).thenReturn(Optional.empty());
                });
    }

    /** 拒绝并写完 401 响应，返回空 Optional 让调用方不再继续 */
    private Mono<Optional<JWTClaimsSet>> reject(ServerWebExchange exchange) {
        return unauthorized(exchange, CommonErrorCode.UNAUTHORIZED.message())
                .thenReturn(Optional.empty());
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
                    // 先剥再注入。顺序写反就是漏洞：客户端自带的 X-User-Id 会残留。
                    h.remove(Headers.USER_ID);
                    h.remove(Headers.USER_ROLES);
                    h.set(Headers.USER_ID, userId);
                    h.set(Headers.USER_ROLES, roles);
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
            bytes = ("{\"code\":" + CommonErrorCode.INTERNAL.code() + "}").getBytes(StandardCharsets.UTF_8);
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
