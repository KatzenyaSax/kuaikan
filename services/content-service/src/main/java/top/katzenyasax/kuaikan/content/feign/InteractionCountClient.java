package top.katzenyasax.kuaikan.content.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;

import java.util.List;

/**
 * 对账用：问 interaction 要这些目标的**事实计数**。
 *
 * 为什么不让 content 直接读 t_interaction：ADR 0006 规定一库一账号，
 * content 对 interaction 的库没有任何权限。真值由所有者提供，
 * 写入由所有者执行——多一次 HTTP，但边界干净。
 */
@FeignClient(name = "interaction-service", path = "/internal")
public interface InteractionCountClient {

    @GetMapping("/counts")
    Result<List<TargetCountView>> counts(@RequestParam("targets") String targets);
}
