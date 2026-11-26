package top.katzenyasax.kuaikan.ai.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.ai.service.AiProfileService;
import top.katzenyasax.kuaikan.ai.web.dto.ProfileEntryRequest;
import top.katzenyasax.kuaikan.ai.web.dto.ProfileEntryView;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.UserContext;

import java.util.List;

/**
 * 个人 AI 档案条目 CRUD（网关对外 /api/ai/profile/entries）。
 */
@Tag(name = "AI 档案")
@RestController
@RequestMapping("/profile/entries")
public class AiProfileController {

    private final AiProfileService profileService;

    public AiProfileController(AiProfileService profileService) {
        this.profileService = profileService;
    }

    @Operation(operationId = "listAiProfileEntries", summary = "查询我的 AI 档案条目")
    @GetMapping
    public Result<List<ProfileEntryView>> list() {
        return Result.ok(profileService.listEntries(requireUserId()));
    }

    @Operation(operationId = "createAiProfileEntry", summary = "新增 AI 档案条目")
    @PostMapping
    public Result<ProfileEntryView> create(@RequestBody ProfileEntryRequest req) {
        return Result.ok(profileService.createEntry(requireUserId(), req));
    }

    @Operation(operationId = "updateAiProfileEntry", summary = "更新 AI 档案条目")
    @PutMapping("/{id}")
    public Result<ProfileEntryView> update(@PathVariable("id") Long id,
                                           @RequestBody ProfileEntryRequest req) {
        return Result.ok(profileService.updateEntry(requireUserId(), id, req));
    }

    @Operation(operationId = "deleteAiProfileEntry", summary = "删除 AI 档案条目")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable("id") Long id) {
        profileService.deleteEntry(requireUserId(), id);
        return Result.ok();
    }

    private Long requireUserId() {
        Long userId = UserContext.userId();
        if (userId == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return userId;
    }
}
