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

@FeignClient(name = Services.CONTENT)
public interface ContentClient {

    @GetMapping("/posts/{postId}")
    Result<PostRow> getPost(@PathVariable("postId") Long postId);

    @GetMapping("/posts/{postId}/comments")
    Result<CommentPageRow> listComments(
            @PathVariable("postId") Long postId,
            @RequestParam(value = "sort", required = false) String sort,
            @RequestParam(value = "limit", required = false) Integer limit);

    @PostMapping("/internal/posts/batch")
    Result<List<PostSummaryRow>> batchPosts(@RequestBody BatchPostsReq request);

    record PostRow(
            String id,
            String communityId,
            String authorId,
            String title,
            String body,
            long commentCount,
            long likeCount,
            long favoriteCount,
            long viewCount,
            long shareCount,
            String createdAt
    ) {}

    record CommentPageRow(List<CommentRow> items, String nextCursor) {}

    record CommentRow(
            String id,
            String postId,
            String rootCommentId,
            String replyToCommentId,
            String replyToUserId,
            String authorId,
            String body,
            long likeCount,
            long replyCount,
            boolean deleted,
            String createdAt
    ) {}

    record BatchPostsReq(List<String> ids) {}

    record PostSummaryRow(
            String id,
            String communityId,
            String authorId,
            String title,
            String createdAt
    ) {}
}
