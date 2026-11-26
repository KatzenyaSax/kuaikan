package top.katzenyasax.kuaikan.ai.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;

public record NoteSummaryView(
        @Schema(type = "string", description = "笔记 ID")
        String id,
        String title,
        String excerpt,
        int length,
        boolean enabled,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
