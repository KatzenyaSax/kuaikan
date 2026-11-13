package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.content.service.CommentService;
import top.katzenyasax.kuaikan.content.web.dto.CommentPage;
import top.katzenyasax.kuaikan.content.web.dto.CommentView;
import top.katzenyasax.kuaikan.content.web.dto.CreateCommentRequest;

/**
 * 评论。
 *
 * 路径刻意分成两组（而不是全挂在 /posts 下）：
 *   一级列表与发评论按帖子定位 → /posts/{postId}/comments
 *   回复列表与删除按评论定位   → /comments/{commentId}/...
 * 这样每条 URL 都只带它真正需要的那个标识，不会出现
 * /posts/1/comments/2 这种"两个 id 都要"的路径。
 *
 * 游客可见面靠网关的 (方法, 路径) 放行规则，两条正则只认数字 id。
 */
@RestController
public class CommentController {

    private final CommentService commentService;

    public CommentController(CommentService commentService) {
        this.commentService = commentService;
    }

    @Operation(operationId = "listComments")
    @PublicEndpoint
    @GetMapping("/posts/{postId}/comments")
    public Result<CommentPage> list(@PathVariable("postId") Long postId,
                                    @RequestParam(required = false) String cursor,
                                    @RequestParam(required = false) Integer limit) {
        return Result.ok(commentService.listTopLevel(postId, cursor, limit));
    }

    @Operation(operationId = "createComment")
    @PostMapping("/posts/{postId}/comments")
    public Result<CommentView> create(@PathVariable("postId") Long postId,
                                      @Valid @RequestBody CreateCommentRequest body) {
        return Result.ok(commentService.create(UserContext.requireUserId(), postId, body));
    }

    @Operation(operationId = "listReplies")
    @PublicEndpoint
    @GetMapping("/comments/{commentId}/replies")
    public Result<CommentPage> replies(@PathVariable("commentId") Long commentId,
                                       @RequestParam(required = false) String cursor,
                                       @RequestParam(required = false) Integer limit) {
        return Result.ok(commentService.listReplies(commentId, cursor, limit));
    }

    @Operation(operationId = "deleteComment")
    @DeleteMapping("/comments/{commentId}")
    public Result<Void> delete(@PathVariable("commentId") Long commentId) {
        commentService.delete(UserContext.requireUserId(), commentId);
        return Result.ok();
    }
}
