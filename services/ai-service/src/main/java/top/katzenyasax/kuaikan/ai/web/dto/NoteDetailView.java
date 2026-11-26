package top.katzenyasax.kuaikan.ai.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.ai.domain.AiNote;

import java.time.LocalDateTime;

public record NoteDetailView(
        @Schema(type = "string", description = "笔记 ID")
        String id,
        String title,
        String content,
        boolean enabled,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static NoteDetailView of(AiNote n) {
        return new NoteDetailView(
                String.valueOf(n.getId()),
                n.getTitle(),
                n.getContent(),
                n.getEnabled() != null && n.getEnabled() == 1,
                n.getCreatedAt(),
                n.getUpdatedAt());
    }
}
