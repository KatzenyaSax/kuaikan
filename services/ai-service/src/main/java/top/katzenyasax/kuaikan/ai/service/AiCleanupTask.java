package top.katzenyasax.kuaikan.ai.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.ai.config.AiProperties;
import top.katzenyasax.kuaikan.ai.domain.AiAction;
import top.katzenyasax.kuaikan.ai.domain.AiConversation;
import top.katzenyasax.kuaikan.ai.domain.AiMessage;
import top.katzenyasax.kuaikan.ai.mapper.AiActionMapper;
import top.katzenyasax.kuaikan.ai.mapper.AiConversationMapper;
import top.katzenyasax.kuaikan.ai.mapper.AiMessageMapper;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 定时清理超过保留期（默认 30 天）或已删除的会话与关联消息/动作记录。
 */
@Component
public class AiCleanupTask {

    private static final Logger log = LoggerFactory.getLogger(AiCleanupTask.class);

    private final AiConversationMapper conversationMapper;
    private final AiMessageMapper messageMapper;
    private final AiActionMapper actionMapper;
    private final AiProperties props;

    public AiCleanupTask(AiConversationMapper conversationMapper,
                         AiMessageMapper messageMapper,
                         AiActionMapper actionMapper,
                         AiProperties props) {
        this.conversationMapper = conversationMapper;
        this.messageMapper = messageMapper;
        this.actionMapper = actionMapper;
        this.props = props;
    }

    @Scheduled(cron = "0 30 3 * * *")
    public void cleanupExpiredConversations() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(props.getRetentionDays());
        List<AiConversation> expired = conversationMapper.selectList(
                new LambdaQueryWrapper<AiConversation>()
                        .select(AiConversation::getId)
                        .and(w -> w.lt(AiConversation::getUpdatedAt, cutoff)
                                .or().eq(AiConversation::getStatus, AiConversation.STATUS_DELETED))
                        .last("LIMIT 500"));
        if (expired.isEmpty()) {
            return;
        }
        List<Long> ids = expired.stream().map(AiConversation::getId).toList();
        actionMapper.delete(new LambdaQueryWrapper<AiAction>().in(AiAction::getConversationId, ids));
        messageMapper.delete(new LambdaQueryWrapper<AiMessage>().in(AiMessage::getConversationId, ids));
        conversationMapper.delete(new LambdaQueryWrapper<AiConversation>().in(AiConversation::getId, ids));
        log.info("清理过期 AI 会话 {} 条", ids.size());
    }
}
