package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.community.service.CommunityGovernanceService;
import top.katzenyasax.kuaikan.community.web.dto.AdminHistoryView;
import top.katzenyasax.kuaikan.community.web.dto.CommunityHistoryView;

/**
 * 社群编年史与历代管理员。**游客可读**（{@code @PublicEndpoint}）。
 *
 * 网关白名单里对应的两条正则（P7.0 已加）：
 *   {@code GET ^/api/community/communities/[^/]+/history$}
 *   {@code GET ^/api/community/communities/[^/]+/admins/history$}
 * 只放行 GET 且路径形状钉死，因此同一前缀下的 my-status / members / bans
 * 不会被顺带放行——那两个端点需要登录，放行了就永远拿不到身份。
 *
 * 公开可读是产品决定：编年史是社群的公共记忆，包括治理记录（谁因为什么被封）。
 * 因此这里**只输出已发生的事实**，不输出任何"我"的字段。
 */
@RestController
@RequestMapping("/communities")
public class CommunityHistoryController {

    private final CommunityGovernanceService governanceService;

    public CommunityHistoryController(CommunityGovernanceService governanceService) {
        this.governanceService = governanceService;
    }

    /**
     * 时间线，按时间倒序游标分页。
     *
     * {@code category} 取 all / milestone / moderation（缺省 all）。
     * 游标**绑定分类**：把 all 的游标拿去查 moderation 会得到 40010，
     * 而不是一段看起来正常、实际跳过了一半事件的列表。
     */
    @Operation(operationId = "listCommunityHistory", summary = "社群历史（游客可读）")
    @PublicEndpoint
    @GetMapping("/{name}/history")
    public Result<PageResult<CommunityHistoryView>> history(
            @PathVariable("name") String name,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(governanceService.history(name, category, cursor, limit));
    }

    /**
     * 历代管理员脉络（从创社首任到现任）。不分页：任数量级是个位数。
     *
     * 任期由事件流（COMMUNITY_CREATED + ADMIN_TRANSFERRED）推导，不存表。
     */
    @Operation(operationId = "listCommunityAdminHistory", summary = "历代社群管理员（游客可读）")
    @PublicEndpoint
    @GetMapping("/{name}/admins/history")
    public Result<AdminHistoryView> adminHistory(@PathVariable("name") String name) {
        return Result.ok(governanceService.adminHistory(name));
    }
}
