package top.katzenyasax.kuaikan.user.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import top.katzenyasax.kuaikan.user.mapper.UserFollowMapper.FollowRow;

import java.time.LocalDateTime;

/**
 * 关注列表 / 粉丝列表 / 我的关注 的一项。
 *
 * 只有 userId / nickname / avatarUrl / followedAt：
 * 头像昵称随关系行一起从本地 t_user 拿到（user-service 自己就是 t_user 的所有者），
 * 不需要前端再走一次批量摘要接口。
 */
public record FollowUserView(
        @Schema(type = "string", description = "对方用户 id（雪花 ID，字符串化）")
        Long userId,
        String nickname,
        String avatarUrl,
        @Schema(description = "关注发生的时间；粉丝列表里是「ta 关注我的时间」")
        LocalDateTime followedAt
) {
    public static FollowUserView of(FollowRow row) {
        return new FollowUserView(row.userId(), row.nickname(), row.avatarUrl(), row.followedAt());
    }
}
