package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.user.domain.User;

/**
 * 内部：批量查询返回的一项（P6.1）。**只有 id 与 nickname。**
 *
 * search-service 只需要这两个字段：{@code authorId} 用于 {@code _update_by_query}
 * 匹配，{@code nickname} 写进索引的 {@code authorNickname}。
 * 不给 avatarUrl / email / status —— 内部接口也不该顺手多带字段，
 * 多一个字段就多一份「以后改它也要维护」的承诺。
 */
public record InternalUserView(
        @Schema(type = "string", description = "用户 id（雪花 id，字符串化）")
        Long id,
        String nickname
) {
    public static InternalUserView of(User user) {
        return new InternalUserView(user.getId(), user.getNickname());
    }
}
