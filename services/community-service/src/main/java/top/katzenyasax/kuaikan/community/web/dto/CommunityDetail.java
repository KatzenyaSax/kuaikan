package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.Community;

import java.time.LocalDateTime;

/**
 * 社群详情。
 *
 * {@code viewerJoined} 是**按查看者变化**的字段：登录用户拿到 true/false，
 * 游客拿到 null。这样社群页不用多发一个请求判断"我加没加入"，
 * 加入按钮也不会先渲染成"加入"再闪成"已加入"。
 */
public record CommunityDetail(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long id,
        String name,
        String description,
        long memberCount,
        @Schema(type = "string", description = "所有者用户 id") Long ownerId,
        LocalDateTime createdAt,
        @Schema(description = "当前查看者是否已加入；游客为 null")
        Boolean viewerJoined,
        @Schema(description = "当前查看者是否为所有者；游客为 null")
        Boolean viewerIsOwner
) {
    public static CommunityDetail of(Community c, Boolean viewerJoined, Boolean viewerIsOwner) {
        return new CommunityDetail(c.getId(), c.getName(), c.getDescription(),
                c.getMemberCount() == null ? 0 : c.getMemberCount(),
                c.getOwnerId(), c.getCreatedAt(), viewerJoined, viewerIsOwner);
    }
}
