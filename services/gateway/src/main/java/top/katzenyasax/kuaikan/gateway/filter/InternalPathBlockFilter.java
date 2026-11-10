package top.katzenyasax.kuaikan.gateway.filter;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.regex.Pattern;

/**
 * 拦截所有 /api/{service}/internal/** 请求并直接返回 404。
 *
 * 存在的唯一原因：路由规则是 /api/user/** + StripPrefix=2，
 * 意味着 /api/user/internal/api-docs 会被转发成 /internal/api-docs 并返回 200。
 * 也就是说，若没有这个过滤器，各服务的契约端点、以及将来的管理端点，
 * 会毫无保护地暴露在公网上。
 *
 * 这把 architecture §10 不变量 7「网关不得路由 /internal/**」
 * 从文档里的承诺变成了代码里的强制。
 *
 * 返回 404 而不是 403：不告诉探测者"这里存在但被禁了"。
 */
@Component
public class InternalPathBlockFilter implements GlobalFilter, Ordered {

    /** /api/{任意一段}/internal 或 /api/{任意一段}/internal/... */
    private static final Pattern INTERNAL_PATH = Pattern.compile("^/api/[^/]+/internal(?:/.*)?$");

    private static final Logger log = LoggerFactory.getLogger(InternalPathBlockFilter.class);

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        if (INTERNAL_PATH.matcher(path).matches()) {
            // 记 warn 是有意的：出现这条日志说明有人在探测内部端点
            log.warn("拦截内部路径访问 path={} remote={}", path, exchange.getRequest().getRemoteAddress());
            exchange.getResponse().setStatusCode(HttpStatus.NOT_FOUND);
            return exchange.getResponse().setComplete();
        }

        return chain.filter(exchange);
    }

    /**
     * 必须早于路由转发（RouteToRequestUrlFilter 的 order 是 10000）。
     * 用负值确保在任何路由级过滤器之前短路。
     */
    @Override
    public int getOrder() {
        return -100;
    }
}
