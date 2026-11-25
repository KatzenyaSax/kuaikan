package top.katzenyasax.kuaikan.ai.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.LocalDateTime;
import java.util.List;

public record MessageView(
        @Schema(type = "string", description = "消息 ID")
        Long id,
        String role,
        String content,
        List<CitationItem> citations,
        List<ActionProposalView> actions,
        PageContextDto pageContext,
        LocalDateTime createdAt
) {
}
