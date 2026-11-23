package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.service.PostService;
import top.katzenyasax.kuaikan.content.web.dto.InternalSearchPostItem;

/**
 * 内部：全量拉取公开帖子（P6.1）。给 search-service 的零停机重建用。
 *
 * <b>只有 {@code GET /internal/search/posts}</b>：搜索本身在 search-service，
 * 这里只回答「库里现在有哪些帖子」。按 id 升序游标分页，保证一次全量遍历
 * 不重不漏；`status = 1` 之外的帖子不会出现在结果里。
 *
 * 网关不路由 {@code /internal/**}（InternalPathBlockFilter），所以只能容器网络直连，
 * 也不需要 {@code @PublicEndpoint}（那个注解是给 check-openapi 比对白名单用的）。
 *
 * 用 {@code @Hidden}：这是服务对服务的接口，不是前端契约的一部分。
 */
@Hidden
@RestController
@RequestMapping("/internal/search")
public class InternalSearchController {

    private final PostService postService;

    public InternalSearchController(PostService postService) {
        this.postService = postService;
    }

    /**
     * @param cursor 上一页返回的 {@code nextCursor}；为空表示第一页
     * @param limit  每页条数，默认 200，上限 500
     */
    @GetMapping("/posts")
    public Result<PageResult<InternalSearchPostItem>> posts(
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(postService.indexPage(cursor, limit));
    }
}
