package top.katzenyasax.kuaikan.search.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.feign.dto.BatchUsersRequest;
import top.katzenyasax.kuaikan.search.feign.dto.InternalUserView;

import java.util.List;

/**
 * user-service 的内部批量昵称接口。
 *
 * <b>单条消费也走批量</b>：一次发帖只有一个作者，但重建时一页有上百个作者。
 * 为两种情况各开一个端点，只会让调用方面临"什么时候用哪个"的选择
 * （p6-search.md §3.2）。
 *
 * <b>返回里没有的 id = 账号已注销</b>，不是错误；调用方降级为「已注销用户」。
 */
@FeignClient(name = "user-service", path = "/internal/users")
public interface UserDirectoryClient {

    @PostMapping("/batch")
    Result<List<InternalUserView>> batch(@RequestBody BatchUsersRequest request);
}
