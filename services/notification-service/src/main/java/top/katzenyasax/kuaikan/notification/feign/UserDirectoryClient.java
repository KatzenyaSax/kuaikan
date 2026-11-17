package top.katzenyasax.kuaikan.notification.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.notification.feign.dto.UserSummaryView;

import java.util.List;

/**
 * 拉 actor 的昵称与头像，用于消息快照。
 *
 * 用的是**公开**的用户摘要接口（游客可读），不是内部端点：
 * 它本来就只返回 userId / nickname / avatarUrl 三个字段，没有泄露面，
 * 而"按 id 批量取摘要"这件事全站只有一个实现，不必再造一个。
 */
@FeignClient(name = "user-service")
public interface UserDirectoryClient {

    @GetMapping("/api/user/users")
    Result<List<UserSummaryView>> batch(@RequestParam("ids") String ids);
}
