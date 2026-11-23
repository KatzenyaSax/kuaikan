package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.community.service.CommunityGovernanceService;
import top.katzenyasax.kuaikan.community.web.dto.BanCommunityMemberRequest;
import top.katzenyasax.kuaikan.community.web.dto.CommunityBanView;
import top.katzenyasax.kuaikan.community.web.dto.CommunityDetail;
import top.katzenyasax.kuaikan.community.web.dto.CommunityMemberView;
import top.katzenyasax.kuaikan.community.web.dto.TransferCommunityRequest;
import top.katzenyasax.kuaikan.community.web.dto.UpdateCommunityInfoRequest;

/**
 * 社群管理：编辑信息、转让管理员、成员名单、封禁与解封。
 *
 * 这一整类端点**全部需要登录，且全部不进网关白名单**：
 * 它们的共同前置条件是"调用者是当前管理员"，游客调用的正确答案是
 * 403 + 41007，而不是 401，更不是"看起来成功了"。
 *
 * 路径前缀与 {@link CommunityController} 相同（/communities），靠方法 + 更长的
 * 路径段区分：`GET /communities/{name}` 是公开详情，`PUT /communities/{name}`
 * 是本类的编辑。Spring 里这是两个独立映射，不会相互遮蔽。
 */
@RestController
@RequestMapping("/communities")
public class CommunityAdminController {

    private final CommunityGovernanceService governanceService;

    public CommunityAdminController(CommunityGovernanceService governanceService) {
        this.governanceService = governanceService;
    }

    /**
     * 编辑简介 / 头像 / 公告。**名称不可改**（它是 URL 与消息快照的一部分）。
     *
     * 没有任何实际变化时不写历史，也不写库——返回的仍是当前详情。
     */
    @Operation(operationId = "updateCommunityInfo", summary = "编辑社群信息（仅管理员）")
    @PutMapping("/{name}")
    public Result<CommunityDetail> updateInfo(@PathVariable("name") String name,
                                              @Valid @RequestBody UpdateCommunityInfoRequest body) {
        return Result.ok(governanceService.updateInfo(UserContext.requireUserId(), name, body));
    }

    /**
     * 转让管理员（直接交接，二次确认在前端）。
     *
     * 目标必须是本社群在社且未被有效封禁的成员，否则 41009。
     * 转让后原管理员降为普通成员，P2 的「创建者不能退出」随之失效。
     */
    @Operation(operationId = "transferCommunityAdmin", summary = "转让社群管理员（仅管理员）")
    @PostMapping("/{name}/transfer")
    public Result<CommunityDetail> transfer(@PathVariable("name") String name,
                                            @Valid @RequestBody TransferCommunityRequest body) {
        return Result.ok(governanceService.transfer(UserContext.requireUserId(), name,
                body.targetUserId()));
    }

    /** 在社成员，按加入时间倒序游标分页。管理页用它列出可封禁/可转让的人 */
    @Operation(operationId = "listCommunityMembers", summary = "社群成员名单（仅管理员）")
    @GetMapping("/{name}/members")
    public Result<PageResult<CommunityMemberView>> members(
            @PathVariable("name") String name,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(governanceService.members(UserContext.requireUserId(), name, cursor, limit));
    }

    /**
     * 生效中的封禁名单，按封禁时间倒序游标分页。
     *
     * 已解封与已自然过期的记录不在这里（时间线里仍有 MODERATION 事件可查）。
     */
    @Operation(operationId = "listCommunityBans", summary = "生效中的封禁名单（仅管理员）")
    @GetMapping("/{name}/bans")
    public Result<PageResult<CommunityBanView>> bans(
            @PathVariable("name") String name,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(governanceService.bans(UserContext.requireUserId(), name, cursor, limit));
    }

    /**
     * 封禁用户。`durationDays` 只允许 1 / 7 / 30，null 表示永久。
     *
     * 在社成员会被同步移出并 member_count - 1；封禁自己 → 41008。
     * 允许封禁已退群的人（防发完违规帖退群逃避）。
     */
    @Operation(operationId = "banCommunityMember", summary = "封禁社群用户（仅管理员）")
    @PostMapping("/{name}/bans")
    public Result<CommunityBanView> ban(@PathVariable("name") String name,
                                        @Valid @RequestBody BanCommunityMemberRequest body) {
        return Result.ok(governanceService.ban(UserContext.requireUserId(), name, body));
    }

    /**
     * 解封。**幂等**：本来没被封（或封禁已自然过期）也返回成功，
     * 只有真的解除了一条生效中的封禁才写 MEMBER_UNBANNED 历史。
     */
    @Operation(operationId = "unbanCommunityMember", summary = "解除社群封禁（仅管理员）")
    @DeleteMapping("/{name}/bans/{userId}")
    public Result<Void> unban(@PathVariable("name") String name,
                              @PathVariable("userId") Long userId) {
        governanceService.unban(UserContext.requireUserId(), name, userId);
        return Result.ok();
    }
}
