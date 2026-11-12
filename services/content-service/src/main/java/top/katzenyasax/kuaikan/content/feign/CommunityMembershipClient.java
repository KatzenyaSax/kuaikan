package top.katzenyasax.kuaikan.content.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;

/**
 * 发帖前问 community-service："这个用户是不是这个社群的成员"。
 *
 * 这是 P2 里唯一的**写路径跨服务调用**，也是 ADR 0009 那条边界的落点：
 * 读路径零跨服务依赖，只有发帖依赖 community-service。
 *
 * 身份用显式参数传（ADR 0008），不靠 header 隐式传播。
 * 超时在 application.yml 里设成 500ms —— Feign 默认没有读超时，
 * 下游卡住会顺着把 content-service 的线程池耗光。
 */
@FeignClient(name = "community-service", path = "/internal")
public interface CommunityMembershipClient {

    @GetMapping("/memberships")
    Result<MembershipView> membership(@RequestParam("communityId") Long communityId,
                                      @RequestParam("userId") Long userId);
}
