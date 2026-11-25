package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

@FeignClient(name = Services.SEARCH)
public interface SearchClient {

    @PostMapping("/internal/search/posts")
    Result<PageResult<SearchPostRow>> searchPosts(@RequestBody SearchPostsReq request);

    record SearchPostsReq(
            String keyword,
            String authorId,
            String authorNickname,
            String communityId,
            String communityName,
            String createdFrom,
            String createdTo,
            String sort,
            String cursor,
            Integer limit,
            Boolean includeBody
    ) {}

    record SearchPostRow(
            String postId,
            String communityId,
            String communityName,
            String authorId,
            String authorNickname,
            String title,
            String body,
            String excerpt,
            long createdAt
    ) {}
}
