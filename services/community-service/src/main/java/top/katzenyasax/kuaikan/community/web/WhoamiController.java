package top.katzenyasax.kuaikan.community.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * P1.3 的可观测探针：回报本服务从网关 header 里读到的身份。
 *
 * **刻意不在 `/ping/**` 下**：那个前缀是网关放行的（P0/P0.5 的探针端点），
 * 放行分支会剥离身份头，所以放在那里访问永远是匿名 —— 探针会失去意义。
 *
 * 放在这里，经网关访问时走完整认证路径：
 *   网关验签 → 注入 X-User-Id → UserContextFilter 构造 UserContext → 本接口读出
 * 一条断言就覆盖了 P1.3 的核心链路。
 */
@RestController
public class WhoamiController {

    @GetMapping("/whoami")
    public Result<Map<String, Object>> whoami() {
        Long userId = UserContext.userId();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("authenticated", userId != null);
        body.put("userId", userId == null ? null : String.valueOf(userId));
        body.put("roles", UserContext.roles());
        return Result.ok(body);
    }
}
