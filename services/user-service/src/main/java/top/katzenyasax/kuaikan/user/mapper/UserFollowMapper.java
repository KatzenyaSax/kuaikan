package top.katzenyasax.kuaikan.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import top.katzenyasax.kuaikan.user.domain.UserFollow;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

/**
 * 关注关系。计数一律 COUNT(*)，不维护冗余计数列（ADR 0010）。
 */
@Mapper
public interface UserFollowMapper extends BaseMapper<UserFollow> {

    /**
     * 幂等写入：已关注就什么都不做。
     *
     * <b>返回值决定要不要发事件</b>：
     *   1 = 新插入 → 写 outbox（UserFollowed）
     *   0 = 本来就关注了 → **不写**（幂等的来源，也是「取关再关注 24h 内只收 1 条消息」的第一层）
     */
    @Insert("""
            INSERT IGNORE INTO t_user_follow (id, follower_id, followee_id, created_at)
            VALUES (#{id}, #{followerId}, #{followeeId}, #{createdAt})
            """)
    int insertIgnore(UserFollow row);

    /**
     * 取关（物理删）。返回 1 才是真的删掉了。
     *
     * 关注关系不是内容，不适用逻辑删除 —— 「没有这一行」就是唯一的事实。
     */
    @Delete("""
            DELETE FROM t_user_follow
            WHERE follower_id = #{followerId} AND followee_id = #{followeeId}
            """)
    int deleteByPair(@Param("followerId") Long followerId,
                     @Param("followeeId") Long followeeId);

    /** 是否已关注。命中唯一键前缀，回表一次 */
    @Select("""
            SELECT COUNT(*) FROM t_user_follow
            WHERE follower_id = #{followerId} AND followee_id = #{followeeId}
            """)
    int exists(@Param("followerId") Long followerId,
               @Param("followeeId") Long followeeId);

    /**
     * 我关注的人数。COUNT(*) 走 {@code idx_follower_created} 的覆盖扫描，不回表。
     *
     * <b>不与 t_user 联表</b>：计数要和列表口径一致，而列表按关系行分页；
     * 让计数去过滤"已注销账号"会让「计数 5、列表 4 条」这种不一致凭空出现。
     */
    @Select("SELECT COUNT(*) FROM t_user_follow WHERE follower_id = #{followerId}")
    int countFollowing(@Param("followerId") Long followerId);

    /** 我的粉丝数。COUNT(*) 走 {@code idx_followee_created} */
    @Select("SELECT COUNT(*) FROM t_user_follow WHERE followee_id = #{followeeId}")
    int countFollowers(@Param("followeeId") Long followeeId);

    /**
     * 我关注了这批人里的哪些。
     *
     * 批量状态查询全程只查两次（本方法 + {@link #selectFollowerAmong}），
     * 而不是每个目标查两次 —— 50 个目标时后者就是 100 次往返。
     */
    @Select("""
            <script>
            SELECT followee_id FROM t_user_follow
            WHERE follower_id = #{followerId} AND followee_id IN
            <foreach collection="followeeIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            </script>
            """)
    List<Long> selectFollowingAmong(@Param("followerId") Long followerId,
                                    @Param("followeeIds") Collection<Long> followeeIds);

    /** 这批人里哪些关注了我。有向关系的反方向，所以是另一条索引（idx_followee_created 前缀） */
    @Select("""
            <script>
            SELECT follower_id FROM t_user_follow
            WHERE followee_id = #{followeeId} AND follower_id IN
            <foreach collection="followerIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            </script>
            """)
    List<Long> selectFollowerAmong(@Param("followeeId") Long followeeId,
                                   @Param("followerIds") Collection<Long> followerIds);

    /**
     * 关注列表：目标用户关注的人。按 (created_at DESC, id DESC) 游标分页。
     *
     * {@code cursorAt == null} 表示第一页；{@code /me/following/ids} 也复用它（一次取满上限）。
     * 多取一条由调用方做（limit 传 size + 1）。
     */
    @Select("""
            <script>
            SELECT f.id AS followId, f.followee_id AS userId, u.nickname AS nickname,
                   u.avatar_url AS avatarUrl, f.created_at AS followedAt
            FROM t_user_follow f
            JOIN t_user u ON u.id = f.followee_id
            WHERE f.follower_id = #{followerId}
            <if test="cursorAt != null">
              AND (f.created_at &lt; #{cursorAt}
                   OR (f.created_at = #{cursorAt} AND f.id &lt; #{cursorId}))
            </if>
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT #{limit}
            </script>
            """)
    List<FollowRow> pageFollowing(@Param("followerId") Long followerId,
                                  @Param("cursorAt") LocalDateTime cursorAt,
                                  @Param("cursorId") Long cursorId,
                                  @Param("limit") int limit);

    /** 粉丝列表：关注目标用户的人。游标形状与 {@link #pageFollowing} 完全一致 */
    @Select("""
            <script>
            SELECT f.id AS followId, f.follower_id AS userId, u.nickname AS nickname,
                   u.avatar_url AS avatarUrl, f.created_at AS followedAt
            FROM t_user_follow f
            JOIN t_user u ON u.id = f.follower_id
            WHERE f.followee_id = #{followeeId}
            <if test="cursorAt != null">
              AND (f.created_at &lt; #{cursorAt}
                   OR (f.created_at = #{cursorAt} AND f.id &lt; #{cursorId}))
            </if>
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT #{limit}
            </script>
            """)
    List<FollowRow> pageFollowers(@Param("followeeId") Long followeeId,
                                  @Param("cursorAt") LocalDateTime cursorAt,
                                  @Param("cursorId") Long cursorId,
                                  @Param("limit") int limit);

    /**
     * 一条关注关系 + 对方摘要。
     *
     * {@code followId} 只用于游标（排序平局时的第二列），不对外暴露 ——
     * 它是关系行的 id，不是用户 id，前端拿它没有意义。
     */
    record FollowRow(Long followId, Long userId, String nickname, String avatarUrl,
                     LocalDateTime followedAt) {
    }
}
