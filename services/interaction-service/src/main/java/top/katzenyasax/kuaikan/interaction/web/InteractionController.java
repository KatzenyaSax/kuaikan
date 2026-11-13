package top.katzenyasax.kuaikan.interaction.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.interaction.domain.Interaction;
import top.katzenyasax.kuaikan.interaction.service.InteractionService;
import top.katzenyasax.kuaikan.interaction.web.dto.InteractionState;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetRequest;

import java.util.ArrayList;
import java.util.List;

/**
 * 点赞与收藏。
 *
 * 全部需要登录 —— 互动天然是"我"的行为，游客没有可表达的意图。
 * 这也是为什么它们都从 UserContext 取用户，路径里不带 user id。
 *
 * 语义是"设为某状态"而不是"翻转"，所以用 POST/DELETE 而不是一个 toggle 接口：
 * 重复 POST 幂等、重复 DELETE 幂等，前端重复点击不会产生一赞一取消。
 */
@RestController
public class InteractionController {

    private final InteractionService interactionService;

    public InteractionController(InteractionService interactionService) {
        this.interactionService = interactionService;
    }

    @Operation(operationId = "likeTarget")
    @PostMapping("/likes")
    public Result<Void> like(@RequestBody TargetRequest body) {
        interactionService.add(UserContext.requireUserId(), Interaction.KIND_LIKE,
                body.targetTypeValue(), body.targetIdValue());
        return Result.ok();
    }

    @Operation(operationId = "unlikeTarget")
    @DeleteMapping("/likes")
    public Result<Void> unlike(@RequestBody TargetRequest body) {
        interactionService.remove(UserContext.requireUserId(), Interaction.KIND_LIKE,
                body.targetTypeValue(), body.targetIdValue());
        return Result.ok();
    }

    @Operation(operationId = "favoriteTarget")
    @PostMapping("/favorites")
    public Result<Void> favorite(@RequestBody TargetRequest body) {
        interactionService.add(UserContext.requireUserId(), Interaction.KIND_FAVORITE,
                body.targetTypeValue(), body.targetIdValue());
        return Result.ok();
    }

    @Operation(operationId = "unfavoriteTarget")
    @DeleteMapping("/favorites")
    public Result<Void> unfavorite(@RequestBody TargetRequest body) {
        interactionService.remove(UserContext.requireUserId(), Interaction.KIND_FAVORITE,
                body.targetTypeValue(), body.targetIdValue());
        return Result.ok();
    }

    /** 批量查状态。targets 形如 {@code post:1,comment:2} */
    @Operation(operationId = "interactionStates")
    @GetMapping("/states")
    public Result<List<InteractionState>> states(@RequestParam("targets") String targets) {
        List<String> list = new ArrayList<>();
        for (String part : targets.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) {
                list.add(t);
            }
        }
        return Result.ok(interactionService.states(UserContext.requireUserId(), list));
    }
}
