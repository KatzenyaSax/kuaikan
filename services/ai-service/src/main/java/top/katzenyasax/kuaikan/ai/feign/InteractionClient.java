package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

@FeignClient(name = Services.INTERACTION)
public interface InteractionClient {

    @GetMapping("/internal/favorites")
    Result<PageResult<FavoriteRow>> listFavorites(
            @RequestParam("userId") Long userId,
            @RequestParam(value = "limit", required = false) Integer limit);

    record FavoriteRow(String postId, String createdAt) {}
}
