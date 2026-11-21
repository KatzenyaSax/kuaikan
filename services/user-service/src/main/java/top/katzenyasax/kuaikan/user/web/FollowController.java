package top.katzenyasax.kuaikan.user.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.user.service.FollowService;
import top.katzenyasax.kuaikan.user.web.dto.FollowStateView;
import top.katzenyasax.kuaikan.user.web.dto.FollowUserView;
import top.katzenyasax.kuaikan.user.web.dto.UserProfileView;

import java.util.List;
import java.util.Map;

/**
 * 关注关系与用户主页（P5.5.1）。
 *
 * ⚠️ 路径不带 {@code /api/user} 前缀：网关的 {@code StripPrefix=2} 已经把它剥掉了。
 * 写全路径的后果是所有端点静默 404。
 *
 * <b>写路径（follow / unfollow）一律需要登录</b>，关注者只来自 UserContext，
 * 路径里只有被关注者 —— 否则任何人都能替别人关注。
 *
 * <b>读路径（profile / following / followers）游客可读</b>，所以必须标
 * {@link PublicEndpoint}：它让端点进 OpenAPI 时带 {@code security: []}，
 * 由 check-openapi.mjs 与网关白名单做机器比对（漏配白名单 = 游客拿到 401）。
 * 三条都已登记在网关 {@code public-patterns}（p55-social.md §3.6）。
 */
@Tag(name = "关注")
@RestController
public class FollowController {

    private final FollowService followService;

    public FollowController(FollowService followService) {
        this.followService = followService;
    }

    /** 关注。幂等：已关注直接成功，不重复发事件 */
    @Operation(operationId = "followUser", summary = "关注目标用户（幂等）")
    @PostMapping("/users/{userId}/follow")
    public Result<Void> follow(@PathVariable("userId") Long userId) {
        followService.follow(UserContext.requireUserId(), userId);
        return Result.ok();
    }

    /** 取关。幂等：本来没关注也返回成功 */
    @Operation(operationId = "unfollowUser", summary = "取消关注（幂等）")
    @DeleteMapping("/users/{userId}/follow")
    public Result<Void> unfollow(@PathVariable("userId") Long userId) {
        followService.unfollow(UserContext.requireUserId(), userId);
        return Result.ok();
    }

    /**
     * 用户主页资料。游客可读。
     *
     * 不含「我是否关注 ta」—— 那是登录态信息，由前端并发调
     * {@code GET /follows/states?userIds=} 聚合（读路径零跨服务调用）。
     */
    @Operation(operationId = "getUserProfile", summary = "用户公开资料 + 关注数 / 粉丝数")
    @PublicEndpoint
    @GetMapping("/users/{userId}/profile")
    public Result<UserProfileView> profile(@PathVariable("userId") Long userId) {
        return Result.ok(followService.profile(userId));
    }

    /** ta 关注的人。游客可读，游标 (created_at DESC, id DESC) */
    @Operation(operationId = "listFollowing", summary = "ta 关注的人（游标分页）")
    @PublicEndpoint
    @GetMapping("/users/{userId}/following")
    public Result<PageResult<FollowUserView>> following(
            @PathVariable("userId") Long userId,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(followService.following(userId, cursor, limit));
    }

    /** 关注 ta 的人。游客可读 */
    @Operation(operationId = "listFollowers", summary = "关注 ta 的人（游标分页）")
    @PublicEndpoint
    @GetMapping("/users/{userId}/followers")
    public Result<PageResult<FollowUserView>> followers(
            @PathVariable("userId") Long userId,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(followService.followers(userId, cursor, limit));
    }

    /**
     * 批量查我对这批人的关注状态。需要登录。
     *
     * 返回 Map，key 是字符串形式的雪花 id（Map 的 key 天生是字符串，
     * 正好与「id 一律字符串下发」对齐）。单次最多 50 个，非法 id 返回 40010。
     */
    @Operation(operationId = "followStates", summary = "批量查询我对目标用户的关系")
    @GetMapping("/follows/states")
    public Result<Map<String, FollowStateView>> states(
            @RequestParam(value = "userIds", required = false) String userIds) {
        return Result.ok(followService.states(UserContext.requireUserId(), userIds));
    }

    /**
     * 我关注的全部人（含摘要），上限取 {@code kuaikan.follow.max-following}（默认 200）。
     *
     * 给 {@code /following} 页一次性拿全：左栏列表 + 右栏「全部关注」拉帖，
     * 不用反复翻页。路径里没有 userId —— 永远只能是"我自己的"。
     */
    @Operation(operationId = "myFollowing", summary = "我关注的全部人（上限 200）")
    @GetMapping("/me/following/ids")
    public Result<List<FollowUserView>> myFollowing() {
        return Result.ok(followService.myFollowing(UserContext.requireUserId()));
    }
}
