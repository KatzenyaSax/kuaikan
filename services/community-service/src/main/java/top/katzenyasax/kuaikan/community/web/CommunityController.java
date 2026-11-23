package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.community.service.CommunityGovernanceService;
import top.katzenyasax.kuaikan.community.service.CommunityService;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;
import top.katzenyasax.kuaikan.community.web.dto.CreateCommunityRequest;
import top.katzenyasax.kuaikan.community.web.dto.MyCommunityStatus;

/**
 * 社群：列表 / 详情 / 建 / 加入 / 退出 / 我的状态。
 *
 * 网关把 /api/community/** 的 /api/community 前缀剥掉，所以这里映射到 /communities。
 * 建社群需要登录（网关注入 UserContext）；列表与详情标 {@code @PublicEndpoint}，
 * 游客可读 —— 这个注解会让它们在 OpenAPI 里变成 security: []，
 * check-openapi.mjs 据此校验网关白名单有没有漏配。
 *
 * 这个类里的端点分两类，看注解就能区分：
 *   - {@code @PublicEndpoint}：列表 / 详情。**永远匿名**，响应里不能有任何 viewer 字段
 *   - 无注解：建 / 加入 / 退出 / my-status。需要登录，网关不放行
 * 管理类端点（改信息、转让、封禁、成员名单）在 {@link CommunityAdminController}。
 */
@RestController
@RequestMapping("/communities")
public class CommunityController {

    private final CommunityService communityService;
    private final CommunityGovernanceService governanceService;

    public CommunityController(CommunityService communityService,
                              CommunityGovernanceService governanceService) {
        this.communityService = communityService;
        this.governanceService = governanceService;
    }

    @Operation(operationId = "listCommunities")
    @PublicEndpoint
    @GetMapping
    public Result<CommunityPage> list(@RequestParam(required = false) String cursor,
                                      @RequestParam(required = false) Integer limit) {
        return Result.ok(communityService.list(cursor, limit));
    }

    @Operation(operationId = "createCommunity")
    @PostMapping
    public Result<CommunityDetail> create(@Valid @RequestBody CreateCommunityRequest body) {
        Long userId = UserContext.requireUserId();
        return Result.ok(communityService.create(userId, body));
    }

    /**
     * 按名称取详情。名称经规范化后查找，所以大小写不同也能命中。
     *
     * 不带任何按查看者变化的字段：公开端点上一律匿名（见 CommunityDetail）。
     */
    @Operation(operationId = "getCommunity")
    @PublicEndpoint
    @GetMapping("/{name}")
    public Result<CommunityDetail> detail(@PathVariable("name") String name) {
        return Result.ok(communityService.getByName(name));
    }

    /**
     * 加入社群。幂等：重复加入返回成功且 member_count 不变。
     *
     * 路径最后一段是 `membership`，所以不会被公开详情的放行正则误放行
     * （`GET ^/api/community/communities/[^/]+$` 只匹配"最后一段是名称"）。
     */
    @Operation(operationId = "joinCommunity")
    @PostMapping("/{name}/membership")
    public Result<CommunityDetail> join(@PathVariable("name") String name) {
        return Result.ok(communityService.join(UserContext.requireUserId(), name));
    }

    /** 退出社群。幂等：本来就不在社也返回成功。所有者退出 → 41005 */
    @Operation(operationId = "leaveCommunity")
    @DeleteMapping("/{name}/membership")
    public Result<CommunityDetail> leave(@PathVariable("name") String name) {
        return Result.ok(communityService.leave(UserContext.requireUserId(), name));
    }

    /**
     * 我在该社群的状态：是否在社 / 是否管理员 / 是否被封禁。
     *
     * <b>需要登录，且绝不能被网关白名单放行</b>：响应整份都是按人变化的，
     * 一旦被公开路径放行，网关会剥离身份，于是永远返回
     * {@code joined=false, admin=false} —— 症状是"登录了但按钮永远显示未加入"。
     *
     * 与 {@code GET /communities/{name}} 的关系：那个接口**永远匿名且可缓存**，
     * 这个接口只回答"我和它的关系"，两者不合并（否则详情就再也不能被 CDN 缓存）。
     */
    @Operation(operationId = "getMyCommunityStatus", summary = "我在该社群的状态")
    @GetMapping("/{name}/my-status")
    public Result<MyCommunityStatus> myStatus(@PathVariable("name") String name) {
        return Result.ok(governanceService.myStatus(UserContext.requireUserId(), name));
    }
}
