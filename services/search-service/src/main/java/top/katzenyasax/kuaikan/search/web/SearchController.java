package top.katzenyasax.kuaikan.search.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.search.service.SearchService;
import top.katzenyasax.kuaikan.search.web.dto.SearchPostItem;

/**
 * 全站帖子搜索（p6-search.md §5.1）。游客可读。
 *
 * <b>路径是 {@code GET /posts}，不是 {@code /api/search/posts}</b>：
 * 网关给 search-service 配了 {@code StripPrefix=2}，{@code /api/search} 那一层
 * 在网关就被剥掉了。写全路径的后果是所有端点静默 404 ——
 * 这是本项目反复踩过的形状（P4.2 在 notification 上踩过两次）。
 *
 * <b>每个参数都是 {@code required = false}</b>：
 * Spring 的 {@code MissingServletRequestParameterException} 不在
 * {@code GlobalExceptionHandler} 的映射表里，会掉进"未预期异常 → 500"那条兜底。
 * 而"q 没传"本质是参数问题，必须是 40010。所以由 service 层显式校验，
 * 少一环框架魔法，错误码才对得上契约。
 *
 * <b>{@code @PublicEndpoint} 是给 check-openapi 看的</b>：它会让这条端点在 spec 里
 * 变成 {@code security: []}，脚本据此校验网关放行规则覆盖了它（P6.0 已加
 * {@code GET ^/api/search/posts$}）。漏标 = 游客拿到 401 却没人提前发现。
 */
@Tag(name = "搜索")
@RestController
public class SearchController {

    private final SearchService searchService;

    public SearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    /**
     * @param q           关键词，必填（trim 后 1~100 字，否则 40010）
     * @param communityId 可选，按社群过滤（雪花 id 字符串，格式非法 40010）
     * @param sort        {@code relevance}（默认）| {@code latest}，未知值 40010
     * @param cursor      上一页的 {@code nextCursor}；非法或跨排序复用 40010
     * @param limit       每页条数，默认 20，上限 50
     */
    @Operation(operationId = "searchPosts", summary = "全站帖子搜索（游客可读）")
    @PublicEndpoint
    @GetMapping("/posts")
    public Result<PageResult<SearchPostItem>> search(
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "communityId", required = false) String communityId,
            @RequestParam(value = "sort", required = false) String sort,
            @RequestParam(value = "cursor", required = false) String cursor,
            @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(searchService.searchPosts(q, communityId, sort, cursor, limit));
    }
}
