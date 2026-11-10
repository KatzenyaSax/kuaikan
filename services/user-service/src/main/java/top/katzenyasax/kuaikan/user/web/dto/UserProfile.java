package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.user.domain.User;

import java.time.LocalDateTime;

/** 对外的用户资料。刻意不包含 passwordHash / status / bannedReason 等内部字段 */
public record UserProfile(
        @Schema(type = "string", description = "雪花 ID，序列化为字符串避免 JS 精度丢失")
        Long userId,
        String email,
        String nickname,
        String avatarUrl,
        String roles,
        LocalDateTime createdAt
) {
    public static UserProfile of(User user) {
        return new UserProfile(user.getId(), user.getEmail(), user.getNickname(),
                user.getAvatarUrl(), user.getRoles(), user.getCreatedAt());
    }
}
