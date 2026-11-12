package top.katzenyasax.kuaikan.community.web;

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
import top.katzenyasax.kuaikan.community.service.CommunityService;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityPage;
import top.katzenyasax.kuaikan.community.web.dto.CreateCommunityRequest;

/**
 * 社群。
 *
 * 网关把 /api/community/** 的 /api/community 前缀剥掉，所以这里映射到 /communities。
 * 建社群需要登录（网关注入 UserContext）；列表与详情标 {@code @PublicEndpoint}，
 * 游客可读 —— 这个注解会让它们在 OpenAPI 里变成 security: []，
 * check-openapi.mjs 据此校验网关白名单有没有漏配。
 */
@RestController
@RequestMapping("/communities")
public class CommunityController {

    private final CommunityService communityService;

    public CommunityController(CommunityService communityService) {
        this.communityService = communityService;
    }

    @PublicEndpoint
    @GetMapping
    public Result<CommunityPage> list(@RequestParam(required = false) String cursor,
                                      @RequestParam(required = false) Integer limit) {
        return Result.ok(communityService.list(cursor, limit));
    }

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
    @PostMapping("/{name}/membership")
    public Result<CommunityDetail> join(@PathVariable("name") String name) {
        return Result.ok(communityService.join(UserContext.requireUserId(), name));
    }

    /** 退出社群。幂等：本来就不在社也返回成功。所有者退出 → 41005 */
    @DeleteMapping("/{name}/membership")
    public Result<CommunityDetail> leave(@PathVariable("name") String name) {
        return Result.ok(communityService.leave(UserContext.requireUserId(), name));
    }
}
