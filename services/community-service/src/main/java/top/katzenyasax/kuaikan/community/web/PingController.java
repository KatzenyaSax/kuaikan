package top.katzenyasax.kuaikan.community.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.community.mq.P0MqLedger;

import java.net.InetAddress;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/ping")
public class PingController {

    @Value("${spring.application.name}")
    private String serviceName;

    @Value("${server.port}")
    private String port;

    private final P0MqLedger ledger;

    public PingController(P0MqLedger ledger) {
        this.ledger = ledger;
    }

    @GetMapping
    public Result<Map<String, Object>> ping() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", serviceName);
        body.put("port", port);
        body.put("host", InetAddress.getLocalHost().getHostName());
        body.put("java", System.getProperty("java.version"));
        body.put("time", OffsetDateTime.now().toString());
        return Result.ok(body);
    }

    /**
     * P1.3 专用：回报本服务收到的身份。
     *
     * 用途是**观测 Feign 身份传播是否生效** —— 如果 user-service 的 Feign 拦截器
     * 正常工作，这里会看到调用方的用户；如果没传播，这里就是 anonymous。
     * 这是"身份在服务间丢失"这类静默故障唯一的可观测点。
     */
    @GetMapping("/whoami")
    public Result<Map<String, Object>> whoami() {
        Long userId = UserContext.userId();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("service", serviceName);
        body.put("authenticated", userId != null);
        body.put("userId", userId == null ? null : String.valueOf(userId));
        body.put("roles", UserContext.roles());
        return Result.ok(body);
    }

    /** P0 冒烟：回查某条消息是否被本服务消费 */
    @GetMapping("/mq/{traceId}")
    public Result<Map<String, Object>> mqStatus(@PathVariable("traceId") String traceId) {
        return Result.ok(ledger.snapshot(traceId));
    }
}
