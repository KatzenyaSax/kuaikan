package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.Community;

import java.time.LocalDateTime;

/**
 * 列表项。只放卡片要显示的东西：不加成员列表、公告全文、封禁名单——
 * 那些是详情/管理页的事。
 *
 * P7.1 追加 {@code avatarUrl} 与 {@code ownerId}：全站社群头像要同步（首页卡片、
 * 社群切换器、用户主页「社群」Tab），管理员入口也要知道这条社群的 owner 是谁。
 * 都是**社群自身的属性**，所以不违反「公开列表里没有按查看者变化的字段」。
 */
public record CommunitySummary(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long id,
        String name,
        String description,
        @Schema(description = "头像外链；为 null 时前端回落成社群名首字母")
        String avatarUrl,
        long memberCount,
        @Schema(type = "string", description = "管理员（所有者）用户 id")
        Long ownerId,
        LocalDateTime createdAt
) {
    public static CommunitySummary of(Community c) {
        return new CommunitySummary(c.getId(), c.getName(), c.getDescription(), c.getAvatarUrl(),
                c.getMemberCount() == null ? 0 : c.getMemberCount(), c.getOwnerId(), c.getCreatedAt());
    }
}
