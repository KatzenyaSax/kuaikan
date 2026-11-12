package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.user.domain.User;

/**
 * 对外的作者摘要。**只有三个字段，这是刻意的。**
 *
 * 这个接口是游客可读的公网可见面（帖子列表要显示作者昵称头像）。
 * 多一个字段就多一份泄露风险，所以：
 *   - 不给 email（可用于撞库和垃圾邮件）
 *   - 不给 status（泄露"这个账号被封了"）
 *   - 不给 createdAt / lastLoginAt（可推断注册时间、活跃时间）
 *
 * 想加字段之前先问：帖子列表真的需要它吗？
 */
public record UserSummary(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long userId,
        String nickname,
        String avatarUrl
) {
    public static UserSummary of(User user) {
        return new UserSummary(user.getId(), user.getNickname(), user.getAvatarUrl());
    }
}
