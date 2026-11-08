package top.katzenyasax.kuaikan.user.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.Map;

/**
 * P0 专用：验证「Nacos 服务发现 + Feign + LoadBalancer」，
 * 以及「消息消费结果回查」这条跨服务读路径。
 * 服务名来自 Services 常量，不写死 IP。
 */
@FeignClient(name = Services.COMMUNITY, contextId = "communityPingClient")
public interface CommunityPingClient {

    @GetMapping("/ping")
    Result<Map<String, Object>> ping();

    @GetMapping("/ping/mq/{traceId}")
    Result<Map<String, Object>> mqStatus(@PathVariable("traceId") String traceId);
}
