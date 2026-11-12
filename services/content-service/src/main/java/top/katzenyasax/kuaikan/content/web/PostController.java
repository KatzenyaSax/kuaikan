package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.content.service.PostService;
import top.katzenyasax.kuaikan.content.web.dto.CreatePostRequest;
import top.katzenyasax.kuaikan.content.web.dto.PostDetail;

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

    public PostController(PostService postService) {
        this.postService = postService;
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
        return Result.ok(postService.getById(postId));
    }
}
