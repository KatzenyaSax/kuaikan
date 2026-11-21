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
     * 某个作者的时间线第一页（用户主页「ta 发的帖子」与 /following 单人筛选）。
     *
     * 走 {@code idx_author_created (author_id, created_at, id)}：等值前缀 + 排序键
     * 都被覆盖，不需要额外排序。**零 DDL**（见 p55-social.md §5.4）。
     */
    @Select("""
            SELECT * FROM t_post
            WHERE author_id = #{authorId} AND status = 1
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<Post> firstPageByAuthor(@Param("authorId") Long authorId, @Param("limit") int limit);

    /** 某个作者的后续页。参数是上一页最后一行的 (created_at, id) */
    @Select("""
            SELECT * FROM t_post
            WHERE author_id = #{authorId} AND status = 1
              AND (created_at, id) < (#{createdAt}, #{id})
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            """)
    List<Post> pageAfterByAuthor(@Param("authorId") Long authorId,
                                 @Param("createdAt") LocalDateTime createdAt,
                                 @Param("id") Long id,
                                 @Param("limit") int limit);

    /**
     * 一批作者的时间线第一页（/following 的「全部关注」）。
     *
     * {@code IN (...)} 会对每个 author_id 各做一次 idx_author_created 的范围扫描再归并；
     * 单批 200 个作者在 1 万用户规模下是毫秒级，而且全在本地 schema 内（ADR 0006）。
     *
     * 调用方必须先剔除空列表：空 {@code IN ()} 是 SQL 语法错误。
     */
    @Select("""
            <script>
            SELECT * FROM t_post
            WHERE status = 1 AND author_id IN
            <foreach collection="authorIds" item="authorId" open="(" separator="," close=")">
              #{authorId}
            </foreach>
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            </script>
            """)
    List<Post> firstPageByAuthors(@Param("authorIds") List<Long> authorIds,
                                  @Param("limit") int limit);

    /** 一批作者的后续页。游标仍是 (created_at, id)，与单作者列表完全一致 */
    @Select("""
            <script>
            SELECT * FROM t_post
            WHERE status = 1 AND author_id IN
            <foreach collection="authorIds" item="authorId" open="(" separator="," close=")">
              #{authorId}
            </foreach>
              AND (created_at, id) &lt; (#{createdAt}, #{id})
            ORDER BY created_at DESC, id DESC
            LIMIT #{limit}
            </script>
            """)
    List<Post> pageAfterByAuthors(@Param("authorIds") List<Long> authorIds,
                                  @Param("createdAt") LocalDateTime createdAt,
                                  @Param("id") Long id,
                                  @Param("limit") int limit);

    /**
     * 批量按 id 查帖子。只返回**存在且未删除**（{@code status = 1}）的。
     *
     * 给「我的收藏」用：前端按 {@code Map<postId, PostSummary>} 映射，
     * 缺席的 postId 就是「这篇帖子已被删」—— 于是删帖占位不需要额外的字段。
     * 这也是为什么这里必须过滤 status，而不能把已删帖一起返回。
     *
     * 主键 IN 查询，无额外过滤列，走 PRIMARY。加 ORDER BY 只是为了响应确定，
     * 调用方不应依赖这个顺序（顺序由收藏列表给出）。
     */
    @Select("""
            <script>
            SELECT * FROM t_post
            WHERE status = 1 AND id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY created_at DESC, id DESC
            </script>
            """)
    List<Post> selectByIdsNormal(@Param("ids") List<Long> ids);

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
     * 热榜候选帖：窗口内**创建**或**有过互动**的帖子。
     *
     * <b>为什么写成 UNION 而不是 OR</b>：`WHERE a >= x OR b >= y` 在 MySQL 里
     * 通常退化成全表扫描。拆成两条各走各的索引（`idx_status_created` /
     * `idx_status_last_interaction`）再 UNION 去重，两个分支都能用上索引。
     *
     * <b>为什么用 id 游标而不是 offset</b>：不变量 11。这里按 id 倒序翻页，
     * 与"最新帖"无关——候选集不需要有意义的时间序，只需要**不重不漏**。
     *
     * 窗口 `since` 由调用方按"半衰期的若干倍"算出来（见 p5-rank.md §3），
     * 不是拍脑袋的一刀切。
     */
    @Select("""
            <script>
            SELECT * FROM (
              SELECT id, title, author_id, community_id, comment_count, like_count,
                     favorite_count, view_count, share_count, last_interaction_at, created_at
              FROM t_post
              WHERE status = 1 AND created_at &gt;= #{since}
              <if test="cursor != null"> AND id &lt; #{cursor} </if>
              UNION
              SELECT id, title, author_id, community_id, comment_count, like_count,
                     favorite_count, view_count, share_count, last_interaction_at, created_at
              FROM t_post
              WHERE status = 1 AND last_interaction_at &gt;= #{since}
              <if test="cursor != null"> AND id &lt; #{cursor} </if>
            ) x
            ORDER BY x.id DESC
            LIMIT #{limit}
            </script>
            """)
    List<Post> rankCandidates(@Param("since") LocalDateTime since,
                              @Param("cursor") Long cursor,
                              @Param("limit") int limit);

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
