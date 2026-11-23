package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.CommunityHistory;

import java.time.LocalDateTime;

/**
 * 社群时间线的一条事件。
 *
 * {@code targetUserId} 为 null（INFO_UPDATED 没有对象），{@code operatorId}
 * 一定是人。前端拿这两个 id 批量补昵称头像。
 *
 * {@code eventType} 与 {@code category} 都给：前者决定展示文案与图标，
 * 后者是筛选维度。让前端从 eventType 自己推导 category 意味着同一份映射
 * 在前后端各写一遍，迟早对不齐。
 */
public record CommunityHistoryView(
        @Schema(type = "string", description = "事件 id")
        Long id,
        @Schema(description = "COMMUNITY_CREATED / ADMIN_TRANSFERRED / INFO_UPDATED / MEMBER_BANNED / MEMBER_UNBANNED")
        String eventType,
        @Schema(description = "MILESTONE（大事记）/ MODERATION（治理记录）")
        String category,
        @Schema(type = "string", description = "操作人用户 id")
        Long operatorId,
        @Schema(type = "string", description = "事件对象用户 id；信息更新事件为 null")
        Long targetUserId,
        @Schema(description = "给人看的一句话")
        String detail,
        LocalDateTime createdAt
) {
    public static CommunityHistoryView of(CommunityHistory e) {
        return new CommunityHistoryView(e.getId(), e.getEventType(), e.getCategory(),
                e.getOperatorId(), e.getTargetUserId(), e.getDetail(), e.getCreatedAt());
    }
}
