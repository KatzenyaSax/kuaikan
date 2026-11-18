package top.katzenyasax.kuaikan.rank.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.rank.feign.dto.RankCandidateView;

import java.util.List;

/** 内部：热榜候选帖。网关不路由 /internal/**，只能容器网络直连 */
@FeignClient(name = "content-service", path = "/internal")
public interface ContentRankClient {

    @GetMapping("/rank/candidates")
    Result<List<RankCandidateView>> candidates(@RequestParam("since") long since,
                                              @RequestParam("cursor") Long cursor,
                                              @RequestParam("limit") int limit);
}
