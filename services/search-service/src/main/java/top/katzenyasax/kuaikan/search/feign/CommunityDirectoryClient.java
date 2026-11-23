package top.katzenyasax.kuaikan.search.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.feign.dto.BatchCommunitiesRequest;
import top.katzenyasax.kuaikan.search.feign.dto.CommunityNameView;
import top.katzenyasax.kuaikan.search.feign.dto.CommunityRefView;

import java.util.List;

/**
 * community-service 的内部社群名接口。
 *
 * 两个端点并存：
 * <ul>
 *   <li>{@code GET /communities/{id}}：单条消费路径（一次只有 1~2 个社群）</li>
 *   <li>{@code POST /communities/batch}：重建路径（一页 200 条帖子涉及多个社群）</li>
 * </ul>
 *
 * 社群名创建后不可改，所以结果可以永久缓存在本地（Caffeine，上限 2000）。
 */
@FeignClient(name = "community-service", path = "/internal")
public interface CommunityDirectoryClient {

    @GetMapping("/communities/{id}")
    Result<CommunityRefView> byId(@PathVariable("id") Long id);

    @PostMapping("/communities/batch")
    Result<List<CommunityNameView>> batch(@RequestBody BatchCommunitiesRequest request);
}
