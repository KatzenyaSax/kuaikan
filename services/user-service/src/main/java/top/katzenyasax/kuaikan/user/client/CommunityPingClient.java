package top.katzenyasax.kuaikan.user.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.Map;

/**
 * P0 专用：验证「Nacos 服务发现 + Feign + LoadBalancer」三方联动。
 * 服务名来自 Services 常量，不写死 IP —— 这是这一条链路存在的唯一意义。
 */
@FeignClient(name = Services.COMMUNITY, contextId = "communityPingClient")
public interface CommunityPingClient {

    @GetMapping("/ping")
    Result<Map<String, Object>> ping();
}
