package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.Community;

import java.time.LocalDateTime;

/** 列表项。刻意不含 ownerId / description 全文的语义约束——列表只需要卡片信息 */
public record CommunitySummary(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long id,
        String name,
        String description,
        long memberCount,
        LocalDateTime createdAt
) {
    public static CommunitySummary of(Community c) {
        return new CommunitySummary(c.getId(), c.getName(), c.getDescription(),
                c.getMemberCount() == null ? 0 : c.getMemberCount(), c.getCreatedAt());
    }
}
