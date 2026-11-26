package top.katzenyasax.kuaikan.ai.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.ai.domain.AiProfileEntry;

import java.time.LocalDateTime;

public record ProfileEntryView(
        @Schema(type = "string", description = "档案条目 ID")
        String id,
        String category,
        String content,
        boolean enabled,
        String source,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static ProfileEntryView of(AiProfileEntry e) {
        return new ProfileEntryView(
                String.valueOf(e.getId()),
                e.getCategory(),
                e.getContent(),
                e.getEnabled() != null && e.getEnabled() == 1,
                e.getSource(),
                e.getCreatedAt(),
                e.getUpdatedAt());
    }
}
