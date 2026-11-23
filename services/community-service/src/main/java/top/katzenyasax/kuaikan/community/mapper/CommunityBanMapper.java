package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.community.domain.CommunityBan;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface CommunityBanMapper extends BaseMapper<CommunityBan> {

    /**
     * 这个用户此刻是否被这个社群封禁；被封禁则返回那一行，否则 null。
     *
     * **"有效封禁"的唯一定义**：status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))。
     * 本接口里一共出现四次（这一个 + 两个分页 + liftActive）：MyBatis 的注解值
     * 必须是编译期常量，拆不出"可读的共享片段"，所以只能靠这条注释钉住——
     * 改动其中任何一处，其余三处必须同步改。
     *
     * 漏掉 expires_at 判断的后果是"限时封禁到期后仍然进不去社群"，
     * 而且只有等到那一天才会暴露。
     *
     * NOW(3) 用的是 MySQL 会话时钟。它与应用层 {@code LocalDateTime.now()} 同一时区
     * （容器 TZ 与 JDBC serverTimezone 都钉在 Asia/Shanghai，已实测 ——
     * MySQL 侧 {@code @@session.time_zone=+08:00}，容器内 date 与 NOW(3) 一致），
     * 所以写入的 expires_at 和这里的比较是同一把尺子。
     */
    @Select("""
            SELECT * FROM t_community_ban
            WHERE community_id = #{communityId} AND user_id = #{userId}
              AND status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))
            """)
    CommunityBan selectActive(@Param("communityId") Long communityId, @Param("userId") Long userId);

    /**
     * 生效封禁名单的第一页（管理页）。排序与游标都是 (banned_at DESC, id DESC)。
     *
     * 为什么不写成 LambdaQueryWrapper：'有效封禁' 的判定里有 {@code NOW(3)}，
     * 用 wrapper 得靠 {@code apply(原始 SQL)} 拼串，反而更难看出它和
     * {@link #selectActive} 是同一条条件。两页拆成两条方法也是本仓库既有写法
     * （见 CommentMapper.topFirstPage / topPageAfter）。
     */
    @Select("""
            SELECT * FROM t_community_ban
            WHERE community_id = #{communityId}
              AND status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))
            ORDER BY banned_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<CommunityBan> selectActiveFirstPage(@Param("communityId") Long communityId,
                                             @Param("limit") int limit);

    /**
     * 生效封禁名单的续页。游标用行值比较 {@code (banned_at, id) < (?, ?)}，
     * 单列时间戳在并发封禁时会撞同一毫秒，导致重复或跳过。
     */
    @Select("""
            SELECT * FROM t_community_ban
            WHERE community_id = #{communityId}
              AND status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))
              AND (banned_at, id) < (#{bannedAt}, #{id})
            ORDER BY banned_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<CommunityBan> selectActivePageAfter(@Param("communityId") Long communityId,
                                             @Param("bannedAt") LocalDateTime bannedAt,
                                             @Param("id") Long id,
                                             @Param("limit") int limit);

    /**
     * 重新封禁：覆盖已有行（uk_community_user 保证一行）。
     *
     * 为什么不是"先 select，有就 update、没有就 insert"：那在并发下会两个线程都
     * 判成"没有"，其中一个撞唯一键。插入路径由 BaseMapper.insert 做裁判，
     * 撞键后再落到这里，与成员表的 revive 是同一手法。
     *
     * {@code jdbcType} 是必要的：reason / expires_at 允许写回 **NULL**（永久封禁、
     * 不带原因），而 MyBatis 对 null 参数默认的 jdbcType=OTHER 在这种显式 SET 上
     * 不够可靠。这是本仓库第一次出现 jdbcType，别处不需要是因为它们从不传 null。
     */
    @Update("""
            UPDATE t_community_ban
            SET status = 1,
                banned_by = #{bannedBy},
                reason = #{reason,jdbcType=VARCHAR},
                expires_at = #{expiresAt,jdbcType=TIMESTAMP},
                banned_at = #{bannedAt},
                unbanned_at = NULL,
                unbanned_by = NULL
            WHERE community_id = #{communityId} AND user_id = #{userId}
            """)
    int reban(@Param("communityId") Long communityId,
              @Param("userId") Long userId,
              @Param("bannedBy") Long bannedBy,
              @Param("reason") String reason,
              @Param("expiresAt") LocalDateTime expiresAt,
              @Param("bannedAt") LocalDateTime bannedAt);

    /**
     * 解封。**返回 1 才是真的解除了一条生效中的封禁**——只有那时才写
     * MEMBER_UNBANNED 历史（幂等的另一半：已解封/已自然过期都是 0）。
     *
     * 已自然过期的行不动它：它已经无效，把它从 status=1 改成 0 只是多一次写，
     * 却会让"这条封禁是被管理员解封的"这条信息失真。
     */
    @Update("""
            UPDATE t_community_ban
            SET status = 0, unbanned_at = #{now}, unbanned_by = #{operatorId}
            WHERE community_id = #{communityId} AND user_id = #{userId}
              AND status = 1 AND (expires_at IS NULL OR expires_at > NOW(3))
            """)
    int liftActive(@Param("communityId") Long communityId,
                   @Param("userId") Long userId,
                   @Param("operatorId") Long operatorId,
                   @Param("now") LocalDateTime now);
}
