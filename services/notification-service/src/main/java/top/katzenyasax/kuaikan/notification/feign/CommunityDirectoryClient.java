package top.katzenyasax.kuaikan.notification.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.notification.feign.dto.CommunityRef;

/**
 * 社群 id -> 名字。给消息快照拼跳转 URL 用。
 *
 * 只能走容器网络直连——网关不路由 {@code /internal/**}。
 */
@FeignClient(name = "community-service", path = "/internal")
public interface CommunityDirectoryClient {

    @GetMapping("/communities/{id}")
    Result<CommunityRef> byId(@PathVariable("id") Long id);
}
