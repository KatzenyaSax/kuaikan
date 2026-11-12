package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.Community;

import java.time.LocalDateTime;

/**
 * 社群详情。**完全匿名**——响应里没有任何按查看者变化的字段。
 *
 * 曾经想在这里带 viewerJoined/viewerIsOwner 来省一个请求，但那要求网关在
 * 公开路径上也做"可选认证"：有效 token 就注入身份、没有就当匿名。
 * 实测发现做不到——网关的放行分支是**一律剥离身份**，公开路径上永远是匿名。
 *
 * 与其把网关改成"公开路径吞掉验签失败"，不如保持一条无例外的规则：
 * **放行 = 匿名，永远。** "我加没加入"由 P2.2 的 /mine 回答（它本来就要给
 * 左栏的"我加入的社群"用），前端用同一份缓存判断按钮状态。
 */
public record CommunityDetail(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long id,
        String name,
        String description,
        long memberCount,
        @Schema(type = "string", description = "所有者用户 id") Long ownerId,
        LocalDateTime createdAt
) {
    public static CommunityDetail of(Community c) {
        return new CommunityDetail(c.getId(), c.getName(), c.getDescription(),
                c.getMemberCount() == null ? 0 : c.getMemberCount(),
                c.getOwnerId(), c.getCreatedAt());
    }
}
