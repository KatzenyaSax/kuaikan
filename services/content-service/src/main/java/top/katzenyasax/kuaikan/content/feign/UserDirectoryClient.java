package top.katzenyasax.kuaikan.content.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.feign.dto.UserSummaryView;

import java.util.List;

/**
 * 内部：把昵称变成 userId。给 `@昵称` 解析用（P4.1）。
 *
 * 只能走容器网络直连——网关不路由 `/internal/**`。
 *
 * 超时在 application.yml 里设短（见 {@code feign.client.config}）：这是**评论写路径**上的
 * 第 2、3 次跨服务调用，卡住会直接拖慢用户发评论。宁可解析失败也不能慢。
 */
@FeignClient(name = "user-service", path = "/internal/users")
public interface UserDirectoryClient {

    /**
     * @param names 逗号分隔的昵称。昵称没有唯一约束，同一昵称可能返回多行（按 id 升序）
     */
    @GetMapping("/by-nicknames")
    Result<List<UserSummaryView>> byNicknames(@RequestParam("names") String names);
}
