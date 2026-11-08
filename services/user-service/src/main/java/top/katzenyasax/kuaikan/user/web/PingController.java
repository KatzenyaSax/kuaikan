package top.katzenyasax.kuaikan.user.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.user.client.CommunityPingClient;

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

    private final CommunityPingClient communityPingClient;

    public PingController(CommunityPingClient communityPingClient) {
        this.communityPingClient = communityPingClient;
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
     * P0 验收用：证明 user-service 通过 Nacos 发现并调用 community-service。
     * 返回体里带 community-service 自报的实例信息，硬编码 IP 无法伪造。
     */
    @GetMapping("/feign")
    public Result<Map<String, Object>> feign() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("caller", serviceName);
        body.put("protocol", "Feign + Nacos discovery + LoadBalancer");
        body.put("callee", communityPingClient.ping().data());
        return Result.ok(body);
    }
}
