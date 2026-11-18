package top.katzenyasax.kuaikan.rank.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.rank.feign.dto.CommunityRefView;

/** 内部：社群 id -> 名字。榜单要显示"来自哪个社群" */
@FeignClient(name = "community-service", path = "/internal")
public interface CommunityRefClient {

    @GetMapping("/communities/{id}")
    Result<CommunityRefView> byId(@PathVariable("id") Long id);
}
