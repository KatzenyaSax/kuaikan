package top.katzenyasax.kuaikan.user.web;

import io.swagger.v3.oas.annotations.Hidden;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.auth.AccountAdminService;
import top.katzenyasax.kuaikan.user.web.dto.AdminUserRequest;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 运维端点。**不经网关**（网关不路由 /internal/**），只能从服务器上 docker exec 调用。
 *
 * 用法：
 *   docker exec kuaikan-user-service-1 \
 *     curl -s -X POST http://127.0.0.1:8081/internal/admin/kick \
 *     -H 'Content-Type: application/json' -d '{"userId":"2120086839598772225"}'
 */
@Hidden
@RestController
@RequestMapping("/internal/admin")
public class InternalAdminController {

    private final AccountAdminService adminService;

    public InternalAdminController(AccountAdminService adminService) {
        this.adminService = adminService;
    }

    @PostMapping("/kick")
    public Result<Map<String, Object>> kick(@Valid @RequestBody AdminUserRequest body) {
        AccountAdminService.KickResult r = adminService.kick(parse(body.userId()));
        return Result.ok(describe(body.userId(), r));
    }

    @PostMapping("/ban")
    public Result<Map<String, Object>> ban(@Valid @RequestBody AdminUserRequest body) {
        AccountAdminService.KickResult r = adminService.ban(parse(body.userId()), body.reason());
        return Result.ok(describe(body.userId(), r));
    }

    @PostMapping("/unban")
    public Result<Map<String, Object>> unban(@Valid @RequestBody AdminUserRequest body) {
        adminService.unban(parse(body.userId()));
        return Result.ok(Map.of("userId", body.userId(), "status", "NORMAL"));
    }

    private Map<String, Object> describe(String userId, AccountAdminService.KickResult r) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("userId", userId);
        body.put("accessRevoked", r.accessRevoked());
        body.put("refreshRevoked", r.refreshRevoked());
        return body;
    }

    private Long parse(String userId) {
        try {
            return Long.valueOf(userId.trim());
        } catch (NumberFormatException e) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "userId 必须是数字字符串");
        }
    }
}
