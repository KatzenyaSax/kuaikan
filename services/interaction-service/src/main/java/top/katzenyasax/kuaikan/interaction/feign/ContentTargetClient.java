package top.katzenyasax.kuaikan.interaction.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;

/**
 * 点赞前问 content："这个目标存在吗？作者是谁？"
 *
 * 两个用途：
 *   1. 给不存在的帖子/评论写点赞事实，对账时无从发现 —— 必须挡在写入前
 *   2. 事件载荷需要 {@code targetOwnerId}（P4 的"有人赞了你"用），content 才知道
 */
@FeignClient(name = "content-service", path = "/internal")
public interface ContentTargetClient {

    @GetMapping("/targets")
    Result<TargetView> target(@RequestParam("type") String type, @RequestParam("id") Long id);
}
