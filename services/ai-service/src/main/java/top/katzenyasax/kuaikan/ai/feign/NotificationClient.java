package top.katzenyasax.kuaikan.ai.feign;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.web.Services;

import java.util.List;

@FeignClient(name = Services.NOTIFICATION)
public interface NotificationClient {

    @GetMapping("/internal/messages/unread")
    Result<List<UnreadMessageRow>> listUnread(
            @RequestParam("userId") Long userId,
            @RequestParam(value = "limit", required = false) Integer limit);

    record UnreadMessageRow(
            String id,
            String type,
            String actorId,
            String actorNickname,
            String targetType,
            String targetId,
            String targetTitle,
            String communityName,
            String postId,
            String commentId,
            String rootCommentId,
            String excerpt,
            String createdAt
    ) {}
}
