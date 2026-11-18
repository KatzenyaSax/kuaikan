package top.katzenyasax.kuaikan.content.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.content.domain.Post;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface PostMapper extends BaseMapper<Post> {

    /**
     * 社群时间线第一页。
     *
     * 用<b>行值比较</b> {@code (created_at, id) < (?, ?)} 而不是
     * {@code created_at < ? OR (created_at = ? AND id < ?)}：前者能直接走
     * {@code idx_community_created (community_id, status, created_at, id)}，
     * 后者在优化器眼里是不等值组合，容易退化成额外排序。
     *
     * 单列 created_at 不够：并发发帖会撞同一个毫秒，只比时间会重复或跳过。
     */
    @Select("""
            SELECT * FROM t_post
            WHERE community_id = #{communityId} AND status = 1
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<Post> firstPage(@Param("communityId") Long communityId, @Param("limit") int limit);

    /** 后续页。参数是上一页最后一行的 (created_at, id) */
    @Select("""
            SELECT * FROM t_post
            WHERE community_id = #{communityId} AND status = 1
              AND (created_at, id) < (#{createdAt}, #{id})
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<Post> pageAfter(@Param("communityId") Long communityId,
                         @Param("createdAt") LocalDateTime createdAt,
                         @Param("id") Long id,
                         @Param("limit") int limit);

    /**
     * 全站最新帖（跨社群）。首页用。
     *
     * 走 {@code idx_community_created} 用不上（没有 community_id 前缀），
     * 所以这里会扫全表排序。P3 的数据量可以接受；
     * 数据长大后要加一张"最新帖"的物化表或走 Redis ZSet（P5 的 rank 服务）。
     */
    @Select("""
            SELECT * FROM t_post
            WHERE status = 1
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<Post> latestPosts(@Param("limit") int limit);

    /**
     * 评论数 ±1。**相对更新，绝不读-改-写**（同 member_count 的理由）。
     * 强一致计数：与评论的插入/删除在同一个本地事务里。
     */
    @Update("UPDATE t_post SET comment_count = comment_count + 1 WHERE id = #{id}")
    int incrementCommentCount(@Param("id") Long id);

    @Update("""
            UPDATE t_post SET comment_count = comment_count - 1
            WHERE id = #{id} AND comment_count > 0
            """)
    int decrementCommentCount(@Param("id") Long id);

    /** 浏览量批量回写。由 PostViewCounter 定时调用，一次一批增量 */
    @Update("UPDATE t_post SET view_count = view_count + #{delta} WHERE id = #{id}")
    int addViewCount(@Param("id") Long id, @Param("delta") int delta);

    @Update("UPDATE t_post SET share_count = share_count + 1 WHERE id = #{id}")
    int incrementShareCount(@Param("id") Long id);

    /**
     * 刷新最后互动时刻。热度用它当衰减基准。
     *
     * <b>只在更晚时更新</b>：并发下两个事件可能乱序到达，
     * 不加条件会把时间往回拨，让帖子凭空"变旧"。
     */
    @Update("""
            UPDATE t_post SET last_interaction_at = #{at}
            WHERE id = #{id}
              AND (last_interaction_at IS NULL OR last_interaction_at < #{at})
            """)
    int touchLastInteraction(@Param("id") Long id, @Param("at") LocalDateTime at);
}
