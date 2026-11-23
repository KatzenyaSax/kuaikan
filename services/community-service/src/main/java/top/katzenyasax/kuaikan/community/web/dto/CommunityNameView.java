package top.katzenyasax.kuaikan.community.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.community.domain.Community;

/**
 * 内部：批量查询返回的一项（P6.1）。**只有 id 与 name。**
 *
 * search-service 只需要这两个字段：{@code id} 对齐索引里的 {@code communityId}，
 * {@code name} 写进 {@code communityName}（帖子路由用名字而不是 id）。
 * 社群名创建后不可改，所以调用方可以永久本地缓存。
 */
public record CommunityNameView(
        @Schema(type = "string", description = "社群 id（雪花 id，字符串化）")
        Long id,
        String name
) {
    public static CommunityNameView of(Community community) {
        return new CommunityNameView(community.getId(), community.getName());
    }
}
