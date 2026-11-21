package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.community.service.CommunityService;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;

/**
 * 指定用户已加入的社群（用户主页的「社群」Tab）。
 *
 * <b>游客可读</b>：标 {@link PublicEndpoint}，网关 {@code public-patterns} 里已有
 * {@code GET ^/api/community/users/[^/]+/communities$}（p55-social.md §3.6）。
 *
 * 路径首段是字面量 {@code users}，与 {@code /communities/...} 系列完全错开，
 * 不会被社群详情的放行正则误伤，也不会和 {@code /communities/{name}} 抢路由。
 *
 * <b>不校验用户是否存在</b>（ADR 0005）：那需要同步调 user-service，
 * 而读路径零跨服务调用是硬约束。用户不存在时自然返回空页 —— 游客视角下
 * 「没有公开社群的人」与「不存在的人」本来就区分不了，也不该区分。
 */
@RestController
public class UserCommunitiesController {

    private final CommunityService communityService;

    public UserCommunitiesController(CommunityService communityService) {
        this.communityService = communityService;
    }

    /** ta 加入的社群。按 joined_at DESC, id DESC 游标分页 */
    @Operation(operationId = "listUserCommunities")
    @PublicEndpoint
    @GetMapping("/users/{userId}/communities")
    public Result<CommunityPage> userCommunities(@PathVariable("userId") Long userId,
                                                 @RequestParam(required = false) String cursor,
                                                 @RequestParam(required = false) Integer limit) {
        return Result.ok(communityService.userCommunities(userId, cursor, limit));
    }
}
