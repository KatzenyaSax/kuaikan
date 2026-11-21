package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.content.service.PostService;
import top.katzenyasax.kuaikan.content.web.dto.CreatePostRequest;
import top.katzenyasax.kuaikan.content.web.dto.PostDetail;
import top.katzenyasax.kuaikan.content.web.dto.PostPage;
import top.katzenyasax.kuaikan.content.web.dto.PostSummary;
import top.katzenyasax.kuaikan.content.web.dto.PostsByAuthorsRequest;

/**
 * 帖子。网关剥掉 /api/content 前缀后映射到 /posts。
 *
 * 发帖需要登录（POST 不标 @PublicEndpoint）；
 * 详情游客可读 —— 网关放行规则是 (方法, 路径) 二元组，
 * 所以同一路径上 GET 公开、POST 需要登录是可以共存的。
 */
@RestController
@RequestMapping("/posts")
public class PostController {

    private final PostService postService;
    private final top.katzenyasax.kuaikan.content.service.PostViewCounter viewCounter;

    public PostController(PostService postService,
                          top.katzenyasax.kuaikan.content.service.PostViewCounter viewCounter) {
        this.postService = postService;
        this.viewCounter = viewCounter;
    }

    /**
     * 帖子列表。游客可读。
     *
     * P5.5 起接受 {@code communityId} 或 {@code authorId}（**二选一**，两个都空或都传都是 40010）：
     *   - communityId：P2 既有行为，游标格式与游标标记保持原样；
     *   - authorId：用户主页「ta 发的帖子」与 /following 单人筛选，
     *     使用独立游标标记，拿错游标会明确报 40010 而不是静默串用。
     *
     * 网关放行规则是 {@code GET /api/content/posts}（精确路径，不含 query），
     * 所以加参数不需要新增白名单。
     */
    @Operation(operationId = "listPosts")
    @PublicEndpoint
    @GetMapping
    public Result<PostPage> list(@RequestParam(required = false) Long communityId,
                                 @RequestParam(required = false) Long authorId,
                                 @RequestParam(required = false) String sort,
                                 @RequestParam(required = false) String cursor,
                                 @RequestParam(required = false) Integer limit) {
        return Result.ok(postService.list(communityId, authorId, sort, cursor, limit));
    }

    /**
     * 一批作者的帖子。{@code /following} 页的「全部关注」专用。
     *
     * <b>需要登录</b>：不标 {@link PublicEndpoint}（网关白名单里也刻意没有它），
     * 入口显式拦一道 —— 这条读路径面向「已登录用户的关注流」，游客没有意义。
     *
     * 用 POST 放 body 而不是 GET 拼 query：200 个雪花 id 的 query string 约 4 KB，
     * 正好在容器/代理的 URI 长度上限附近（p55-social.md §3.3）。
     */
    @Operation(operationId = "listPostsByAuthors")
    @PostMapping("/by-authors")
    public Result<PostPage> listByAuthors(@Valid @RequestBody PostsByAuthorsRequest body) {
        UserContext.requireUserId();
        return Result.ok(postService.listByAuthors(body));
    }

    /**
     * 全站最新帖，跨社群。首页用。
     *
     * 路径是 {@code /posts/latest}，与 {@code /posts/{postId}} 不冲突：
     * Spring 优先匹配字面量段，而 {@code latest} 也不是合法数字。
     */
    @Operation(operationId = "latestPosts")
    @PublicEndpoint
    @GetMapping("/latest")
    public Result<java.util.List<PostSummary>> latest(@RequestParam(required = false) Integer limit) {
        return Result.ok(postService.listLatest(limit));
    }

    @Operation(operationId = "createPost")
    @PostMapping
    public Result<PostDetail> create(@Valid @RequestBody CreatePostRequest body) {
        return Result.ok(postService.create(UserContext.requireUserId(), body));
    }

    @Operation(operationId = "getPost")
    @PublicEndpoint
    @GetMapping("/{postId}")
    public Result<PostDetail> detail(@PathVariable("postId") Long postId) {
        PostDetail detail = postService.getById(postId);
        // 记一次浏览。放在 getById **之后**：帖子不存在时不该计一次浏览。
        // 内部是 Redis INCR，失败只记 WARN，不会让详情页 500。
        viewCounter.recordView(postId);
        return Result.ok(detail);
    }

    /**
     * 记一次分享。
     *
     * <b>允许游客</b>：分享本身不该要求登录。代价是可被刷，
     * 但分享在热度公式里权重不高，而且这是"不要求精确"的计数之一。
     * 真要防刷是 P7 的限流的事。
     */
    @Operation(operationId = "sharePost")
    @PublicEndpoint
    @PostMapping("/{postId}/share")
    public Result<Long> share(@PathVariable("postId") Long postId) {
        return Result.ok(postService.recordShare(postId));
    }
}
