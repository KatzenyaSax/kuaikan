package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.community.service.CommunityService;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;

/**
 * 我加入的社群。
 *
 * **刻意放在 /mine 而不是 /communities/mine**：社群名就是标识，如果有人把社群
 * 叫作 "mine"，/communities/mine 就会同时是"我的社群"和"那个社群"，只能靠
 * Spring 的路由优先级决定谁赢——那是个没人会记得的陷阱。
 * 放在 /mine 之后，/communities/{name} 的命名空间就是干净的。
 */
@RestController
public class MyCommunitiesController {

    private final CommunityService communityService;

    public MyCommunitiesController(CommunityService communityService) {
        this.communityService = communityService;
    }

    @Operation(operationId = "listMyCommunities")
    @GetMapping("/mine")
    public Result<CommunityPage> mine(@RequestParam(required = false) String cursor,
                                      @RequestParam(required = false) Integer limit) {
        return Result.ok(communityService.mine(UserContext.requireUserId(), cursor, limit));
    }
}
