package top.katzenyasax.kuaikan.interaction.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.interaction.service.InteractionService;
import top.katzenyasax.kuaikan.interaction.web.dto.FavoriteItem;

/**
 * 内部：读取指定用户的最近收藏帖子列表，专供 ai-service（P8.3）。
 *
 * 网关拦截 /internal/**，公网不可达；userId 由 ai-service 从 UserContext 注入。
 */
@Hidden
@RestController
@RequestMapping("/internal")
public class InternalFavoriteController {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 30;

    private final InteractionService interactionService;

    public InternalFavoriteController(InteractionService interactionService) {
        this.interactionService = interactionService;
    }

    @GetMapping("/favorites")
    public Result<PageResult<FavoriteItem>> listFavorites(
            @RequestParam("userId") Long userId,
            @RequestParam(value = "limit", required = false) Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(limit, MAX_LIMIT));
        return Result.ok(interactionService.myFavorites(userId, null, size));
    }
}
