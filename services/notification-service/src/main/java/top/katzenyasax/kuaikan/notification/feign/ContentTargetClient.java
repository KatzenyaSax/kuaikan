package top.katzenyasax.kuaikan.notification.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.notification.feign.dto.TargetView;

/**
 * 问 content："这个目标存在吗、作者是谁、标题是什么"。
 *
 * 只能走容器网络直连——网关不路由 `/internal/**`。
 */
@FeignClient(name = "content-service", path = "/internal")
public interface ContentTargetClient {

    @GetMapping("/targets")
    Result<TargetView> target(@RequestParam("type") String type, @RequestParam("id") Long id);
}
