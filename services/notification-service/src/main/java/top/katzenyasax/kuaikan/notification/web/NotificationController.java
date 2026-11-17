package top.katzenyasax.kuaikan.notification.web;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.CursorCodec;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.UserContext;
import top.katzenyasax.kuaikan.notification.domain.Message;
import top.katzenyasax.kuaikan.notification.mapper.MessageMapper;
import top.katzenyasax.kuaikan.notification.service.MessageService;
import top.katzenyasax.kuaikan.notification.web.dto.MessagePage;
import top.katzenyasax.kuaikan.notification.web.dto.MessageView;
import top.katzenyasax.kuaikan.notification.web.dto.UnreadView;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * 消息的读接口。
 *
 * 全部需要登录——网关不放行 {@code /api/notification/**}，
 * 而且这里每条查询都以 {@code user_id} 为条件，只能是"我自己的消息"。
 *
 * ⚠️ <b>方法路径不带 {@code /api/notification} 前缀。</b>
 * 网关给每个服务都配了 {@code StripPrefix=2}，`/api/notification` 那一层在网关
 * 就被剥掉了，服务内看到的只有 `/messages`。这是全项目的约定：
 * controller 只声明 {@code @RequestMapping("/posts")} 这种剥完之后的路径。
 * 写全路径的后果是**所有端点静默 404**（表现为 50000 + NoResourceFoundException）。
 */
@Tag(name = "消息")
@RestController
public class NotificationController {

    /** 每个列表的游标标记必须不同，否则拿错列表的游标会被静默解析成错误结果 */
    private static final String SORT_MESSAGES = "message";

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final MessageMapper messageMapper;
    private final MessageService messageService;

    public NotificationController(MessageMapper messageMapper, MessageService messageService) {
        this.messageMapper = messageMapper;
        this.messageService = messageService;
    }

    @Operation(operationId = "listMessages",
            summary = "我的消息，游标分页。type 为空表示全部")
    @GetMapping("/messages")
    public Result<MessagePage> list(@RequestParam(value = "type", required = false) String type,
                                    @RequestParam(value = "cursor", required = false) String cursor,
                                    @RequestParam(value = "limit", required = false) Integer limit) {
        Long userId = requireUserId();
        int size = normalizeLimit(limit);
        CursorCodec.Cursor c = CursorCodec.decode(cursor, SORT_MESSAGES);

        LambdaQueryWrapper<Message> q = new LambdaQueryWrapper<Message>()
                .eq(Message::getUserId, userId);
        if (type != null && !type.isBlank()) {
            q.eq(Message::getType, normalizeType(type));
        }
        if (c != null) {
            // 与列表排序一致：created_at DESC, id DESC。
            // 用 and(...) 包一层，否则 or 会把上面的 user_id 条件一起 or 掉。
            LocalDateTime ts = LocalDateTime.ofInstant(Instant.ofEpochMilli(c.timestampMillis()),
                    ZoneId.systemDefault());
            q.and(w -> w.lt(Message::getCreatedAt, ts)
                    .or(o -> o.eq(Message::getCreatedAt, ts).lt(Message::getId, c.id())));
        }
        // 多取一条用来判断还有没有下一页，避免 count(*)
        q.orderByDesc(Message::getCreatedAt).orderByDesc(Message::getId).last("LIMIT " + (size + 1));

        List<Message> rows = messageMapper.selectList(q);
        boolean hasMore = rows.size() > size;
        List<MessageView> items = new ArrayList<>(Math.min(rows.size(), size));
        for (int i = 0; i < Math.min(rows.size(), size); i++) {
            items.add(MessageView.of(rows.get(i)));
        }

        String next = null;
        if (hasMore && !items.isEmpty()) {
            Message last = rows.get(size - 1);
            long millis = last.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            next = CursorCodec.encode(SORT_MESSAGES, millis, last.getId());
        }
        return Result.ok(new MessagePage(items, next));
    }

    @Operation(operationId = "getUnread", summary = "四类未读计数")
    @GetMapping("/unread")
    public Result<UnreadView> unread() {
        MessageService.Unread u = messageService.unread(requireUserId());
        return Result.ok(new UnreadView(u.like(), u.comment(), u.mention(), u.system(), u.total()));
    }

    /**
     * 全部已读。**幂等**：没有未读的时候调用也返回成功。
     *
     * 返回标记了多少条，便于前端提示与排查——不是错误信息。
     */
    @Operation(operationId = "readAllMessages", summary = "全部标记为已读")
    @PostMapping("/read-all")
    public Result<Integer> readAll() {
        return Result.ok(messageService.markAllRead(requireUserId()));
    }

    /**
     * 身份来自网关注入的 X-User-Id（ADR 0008：不在这里再验一次 token）。
     * 拿不到就是没登录——网关本该挡住，这里是防御性的最后一道。
     */
    private static Long requireUserId() {
        Long userId = UserContext.userId();
        if (userId == null) {
            throw new BizException(CommonErrorCode.UNAUTHORIZED);
        }
        return userId;
    }

    private static int normalizeLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        return Math.max(1, Math.min(limit, MAX_LIMIT));
    }

    private static String normalizeType(String type) {
        String t = type.trim().toUpperCase();
        return switch (t) {
            case Message.TYPE_LIKE, Message.TYPE_COMMENT, Message.TYPE_MENTION, Message.TYPE_SYSTEM -> t;
            // 未知类型不静默变成"全部"——那会让前端以为筛选生效了其实是全量
            default -> throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "type 只能是 LIKE / COMMENT / MENTION / SYSTEM");
        };
    }
}
