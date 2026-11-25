package top.katzenyasax.kuaikan.ai.web.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record ActionProposalView(
        String actionId,
        String type,
        Map<String, Object> payload,
        String status,
        Map<String, Object> result,
        LocalDateTime expiresAt
) {
}
