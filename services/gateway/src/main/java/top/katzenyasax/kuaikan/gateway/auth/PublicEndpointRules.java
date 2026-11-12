package top.katzenyasax.kuaikan.gateway.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 游客可访问的端点规则。**每条规则是 (方法, 路径) 二元组**，不是单独的路径。
 *
 * 为什么必须带方法：同一路径上常常读公开、写需要登录。
 * `/communities` 的 GET 游客可读、POST 需要登录；P2.3 的 `/posts` 也一样。
 * 只按路径放行会把写端点也一起放行，于是网关注入身份的那段被跳过，
 * 下游 `UserContext.requireUserId()` 抛出 401 —— 症状是"带着 token 反而说没登录"，
 * 排查方向很容易跑偏到 token 上。
 *
 * 配置格式：`<METHOD> <路径或正则>`，方法位置写 `*` 表示任意方法。
 * **格式错误在启动时直接抛异常**，不静默降级：一条写错的放行规则意味着
 * 某个端点悄悄地对全网开放，这种错误必须在部署时就炸出来。
 */
@Component
public class PublicEndpointRules {

    private static final Logger log = LoggerFactory.getLogger(PublicEndpointRules.class);

    /** 表示任意方法 */
    private static final String ANY_METHOD = "*";

    private record Rule(String method, Pattern pattern, boolean exact, String raw) {
    }

    private final List<Rule> rules;

    public PublicEndpointRules(GatewayAuthProperties props) {
        List<Rule> parsed = new ArrayList<>();
        for (String raw : props.getWhitelist()) {
            parsed.add(parse(raw, true));
        }
        for (String raw : props.getPublicPatterns()) {
            parsed.add(parse(raw, false));
        }
        this.rules = List.copyOf(parsed);
        log.info("游客放行规则已加载 {} 条", this.rules.size());
        for (Rule r : this.rules) {
            log.info("  放行 {} {}", r.method(), r.raw());
        }
    }

    private static Rule parse(String raw, boolean exact) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalStateException("游客放行规则不能为空");
        }
        int space = raw.indexOf(' ');
        if (space <= 0) {
            throw new IllegalStateException(
                    "游客放行规则必须以 '<METHOD> ' 开头（任意方法写 *），实际：" + raw);
        }
        String method = raw.substring(0, space).trim().toUpperCase(Locale.ROOT);
        String rest = raw.substring(space + 1).trim();
        if (rest.isEmpty()) {
            throw new IllegalStateException("游客放行规则缺少路径：" + raw);
        }
        return new Rule(method,
                exact ? Pattern.compile(Pattern.quote(rest)) : Pattern.compile(rest),
                exact, raw);
    }

    /** true = 该 (方法, 路径) 对游客开放 */
    public boolean isPublic(String method, String path) {
        String m = method == null ? "" : method.toUpperCase(Locale.ROOT);
        for (Rule r : rules) {
            if (!ANY_METHOD.equals(r.method()) && !r.method().equals(m)) {
                continue;
            }
            if (r.pattern().matcher(path).matches()) {
                return true;
            }
        }
        return false;
    }

    /** 供校验脚本/健康检查读取 */
    public List<String> rawRules() {
        return rules.stream().map(Rule::raw).toList();
    }
}
