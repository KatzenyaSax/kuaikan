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

    /** 消息快照只要一小段。整篇正文塞进一条消息没有意义 */
    private static final int EXCERPT_MAX = 120;

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
                        ? TargetView.missing()
                        : TargetView.of(post.getAuthorId(), post.getTitle(), excerpt(post.getBody()),
                                post.getId(), post.getCommunityId());
            }
            case "comment" -> {
                Comment comment = commentMapper.selectById(id);
                if (comment == null || comment.getStatus() != Comment.STATUS_NORMAL) {
                    yield TargetView.missing();
                }
                // 评论被赞时，消息里要显示"赞了你在《某帖》下的评论"——
                // 所以标题取所属帖子，摘录取评论本身
                Post parent = postMapper.selectById(comment.getPostId());
                yield TargetView.of(comment.getAuthorId(),
                        parent == null ? null : parent.getTitle(),
                        excerpt(comment.getBody()),
                        comment.getPostId(),
                        parent == null ? null : parent.getCommunityId());
            }
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "目标类型只能是 post 或 comment");
        });
    }

    private static String excerpt(String body) {
        if (body == null) {
            return null;
        }
        String flat = body.strip();
        return flat.length() <= EXCERPT_MAX ? flat : flat.substring(0, EXCERPT_MAX) + "…";
    }
}
