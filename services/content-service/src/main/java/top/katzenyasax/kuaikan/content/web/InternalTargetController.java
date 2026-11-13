package top.katzenyasax.kuaikan.content.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.content.domain.Comment;
import top.katzenyasax.kuaikan.content.domain.Post;
import top.katzenyasax.kuaikan.content.mapper.CommentMapper;
import top.katzenyasax.kuaikan.content.mapper.PostMapper;
import top.katzenyasax.kuaikan.content.web.dto.TargetView;

/**
 * 内部接口：帖子/评论存在吗、作者是谁。给 interaction 点赞前校验用。
 *
 * 只能容器网络直连 —— 网关不路由 {@code /internal/**}，所以它不在公网可见面上，
 * 也不需要 @PublicEndpoint（那个注解是给 check-openapi 比对放行规则用的）。
 */
@RestController
@RequestMapping("/internal")
public class InternalTargetController {

    private final PostMapper postMapper;
    private final CommentMapper commentMapper;

    public InternalTargetController(PostMapper postMapper, CommentMapper commentMapper) {
        this.postMapper = postMapper;
        this.commentMapper = commentMapper;
    }

    @GetMapping("/targets")
    public Result<TargetView> target(@RequestParam("type") String type, @RequestParam("id") Long id) {
        return Result.ok(switch (type) {
            case "post" -> {
                Post post = postMapper.selectById(id);
                // 已删除的帖子对外一律"不存在"（与详情接口的语义保持一致）
                yield (post == null || post.getStatus() != Post.STATUS_NORMAL)
                        ? TargetView.missing() : TargetView.of(post.getAuthorId());
            }
            case "comment" -> {
                Comment comment = commentMapper.selectById(id);
                yield (comment == null || comment.getStatus() != Comment.STATUS_NORMAL)
                        ? TargetView.missing() : TargetView.of(comment.getAuthorId());
            }
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "目标类型只能是 post 或 comment");
        });
    }
}
