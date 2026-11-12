package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.community.service.CommunityService;
import top.katzenyasax.kuaikan.community.web.dto.MembershipResponse;

/**
 * 内部接口：回答"这个用户是不是这个社群的成员"。
 *
 * 只能容器网络直连 —— 网关不路由 `/internal/**`（InternalPathBlockFilter），
 * 所以它不会出现在公网可见面上，也不需要 @PublicEndpoint（那个注解是给
 * check-openapi 比对白名单用的）。
 *
 * 为什么不加鉴权：身份由调用方显式传参（communityId + userId，ADR 0008），
 * 没有"当前用户"的概念。这是服务对服务的查询，不是用户对服务的请求。
 */
@RestController
@RequestMapping("/internal")
public class InternalMembershipController {

    private final CommunityService communityService;

    public InternalMembershipController(CommunityService communityService) {
        this.communityService = communityService;
    }

    @Operation(operationId = "getMembership")
    @GetMapping("/memberships")
    public Result<MembershipResponse> membership(@RequestParam("communityId") Long communityId,
                                                 @RequestParam("userId") Long userId) {
        return Result.ok(communityService.membership(communityId, userId));
    }
}
