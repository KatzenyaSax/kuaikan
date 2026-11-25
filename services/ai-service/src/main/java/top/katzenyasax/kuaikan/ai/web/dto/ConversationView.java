package top.katzenyasax.kuaikan.ai.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.ai.domain.AiConversation;

import java.time.LocalDateTime;

public record ConversationView(
        @Schema(type = "string", description = "会话 ID")
        Long id,
        String title,
        LocalDateTime createdAt
) {
    public static ConversationView of(AiConversation c) {
        return new ConversationView(c.getId(), c.getTitle(), c.getCreatedAt());
    }
}
