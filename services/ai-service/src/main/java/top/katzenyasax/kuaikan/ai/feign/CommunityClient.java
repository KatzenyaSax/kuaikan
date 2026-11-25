package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.List;

@FeignClient(name = Services.COMMUNITY)
public interface CommunityClient {

    @GetMapping("/internal/communities/{id}")
    Result<CommunityRefRow> getById(@PathVariable("id") Long id);

    @PostMapping("/internal/communities/batch")
    Result<List<CommunityNameRow>> batch(@RequestBody BatchCommunitiesReq request);

    @GetMapping("/users/{userId}/communities")
    Result<CommunityPageRow> userCommunities(
            @PathVariable("userId") Long userId,
            @RequestParam(value = "limit", required = false) Integer limit);

    @GetMapping("/communities")
    Result<CommunityPageRow> listCommunities(@RequestParam(value = "limit", required = false) Integer limit);

    record CommunityRefRow(boolean exists, String name) {}

    record BatchCommunitiesReq(List<String> ids) {}

    record CommunityNameRow(String id, String name) {}

    record CommunityPageRow(List<CommunitySummaryRow> items, String nextCursor) {}

    record CommunitySummaryRow(
            String id,
            String name,
            String description,
            String avatarUrl,
            long memberCount,
            String ownerId,
            String createdAt
    ) {}
}
