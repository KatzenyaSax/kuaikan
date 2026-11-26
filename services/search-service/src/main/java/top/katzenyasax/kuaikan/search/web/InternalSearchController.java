package top.katzenyasax.kuaikan.search.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.PageResult;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.service.SearchService;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchNoteItem;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchNotesRequest;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchPostItem;
import top.katzenyasax.kuaikan.search.web.dto.InternalSearchPostsRequest;

import java.util.List;

/**
 * 对内检索（p6-search.md §5.2）。服务未来 AI 助手 / 运维工具。
 *
 * <b>为什么是 {@code /internal/**}</b>：网关的 {@code InternalPathBlockFilter}
 * 直接不路由这个前缀，所以它只在容器网络内可达 —— 不需要鉴权，
 * 也不会因为"白名单漏了"而对公网暴露。路径与 content-service 的
 * {@code GET /internal/search/posts} 同名但语义不同（那边是"库里有那些帖子"，
 * 这边是"索引里检索什么"），是两个服务各自的资源，不冲突。
 *
 * <b>为什么用 POST 而不是 GET</b>：条件多（keyword / authorId / authorNickname /
 * communityId / communityName / 时间范围 / 分页 / includeBody），
 * 而且 AI 助手的调用方更自然地把这些当结构化参数发。POST 放 body 也让
 * 昵称里的中文、社群名里的空格不用再做 URL 编码。
 *
 * <b>{@code @Hidden}</b>：它不是前端契约的一部分，不进 OpenAPI spec。
 * 进去的后果是 P6.4 给前端生成类型时多出一个"游客永远调不到"的操作。
 */
@Hidden
@RestController
@RequestMapping("/internal/search")
public class InternalSearchController {

    private final SearchService searchService;

    public InternalSearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    @PostMapping("/posts")
    public Result<PageResult<InternalSearchPostItem>> posts(
            @RequestBody(required = false) InternalSearchPostsRequest request) {
        return Result.ok(searchService.searchPostsInternal(request));
    }

    @PostMapping("/notes")
    public Result<List<InternalSearchNoteItem>> notes(
            @RequestBody(required = false) InternalSearchNotesRequest request) {
        return Result.ok(searchService.searchNotesInternal(request));
    }
}
