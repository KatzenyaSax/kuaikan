package top.katzenyasax.kuaikan.notification.web;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.notification.domain.Message;
import top.katzenyasax.kuaikan.notification.mapper.MessageMapper;
import top.katzenyasax.kuaikan.notification.web.dto.MessageView;

import java.util.List;

/**
 * 内部：读取指定用户的未读站内消息列表，专供 ai-service（P8.2 消息速览）。
 *
 * 网关拦截 /internal/**，公网不可达；userId 由 ai-service 服务端从 UserContext 注入。
 */
@Hidden
@RestController
@RequestMapping("/internal")
public class InternalNotificationController {

    private static final int DEFAULT_LIMIT = 15;
    private static final int MAX_LIMIT = 30;

    private final MessageMapper messageMapper;

    public InternalNotificationController(MessageMapper messageMapper) {
        this.messageMapper = messageMapper;
    }

    @GetMapping("/messages/unread")
    public Result<List<MessageView>> listUnread(
            @RequestParam("userId") Long userId,
            @RequestParam(value = "limit", required = false) Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(limit, MAX_LIMIT));
        List<Message> rows = messageMapper.selectList(new LambdaQueryWrapper<Message>()
                .eq(Message::getUserId, userId)
                .isNull(Message::getReadAt)
                .orderByDesc(Message::getCreatedAt)
                .orderByDesc(Message::getId)
                .last("LIMIT " + size));
        return Result.ok(rows.stream().map(MessageView::of).toList());
    }
}
