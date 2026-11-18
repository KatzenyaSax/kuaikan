package top.katzenyasax.kuaikan.content.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.content.domain.Comment;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface CommentMapper extends BaseMapper<Comment> {

    /**
     * 一级评论第一页。{@code root_comment_id IS NULL} 用得上
     * {@code idx_post_root_comment (post_id, root_comment_id, created_at, id)}。
     *
     * 按时间**正序**（老的在上）——评论读起来像对话，倒序会让人从结尾往回读。
     */
    @Select("""
            SELECT * FROM t_comment
            WHERE post_id = #{postId} AND root_comment_id IS NULL
            ORDER BY created_at ASC, id ASC
            LIMIT #{limit}
            """)
    List<Comment> topFirstPage(@Param("postId") Long postId, @Param("limit") int limit);

    /** 一级评论后续页。升序，所以是 {@code >} 而不是 {@code <} */
    @Select("""
            SELECT * FROM t_comment
            WHERE post_id = #{postId} AND root_comment_id IS NULL
              AND (created_at, id) > (#{createdAt}, #{id})
            ORDER BY created_at ASC, id ASC
            LIMIT #{limit}
            """)
    List<Comment> topPageAfter(@Param("postId") Long postId,
                               @Param("createdAt") LocalDateTime createdAt,
                               @Param("id") Long id,
                               @Param("limit") int limit);

    /** 某个一级评论下的回复，同样正序 */
    @Select("""
            SELECT * FROM t_comment
            WHERE root_comment_id = #{rootCommentId}
            ORDER BY created_at ASC, id ASC
            LIMIT #{limit}
            """)
    List<Comment> replyFirstPage(@Param("rootCommentId") Long rootCommentId, @Param("limit") int limit);

    @Select("""
            SELECT * FROM t_comment
            WHERE root_comment_id = #{rootCommentId}
              AND (created_at, id) > (#{createdAt}, #{id})
            ORDER BY created_at ASC, id ASC
            LIMIT #{limit}
            """)
    List<Comment> replyPageAfter(@Param("rootCommentId") Long rootCommentId,
                                 @Param("createdAt") LocalDateTime createdAt,
                                 @Param("id") Long id,
                                 @Param("limit") int limit);

    /** tombstone：保留行（子回复的 root_comment_id 还指着它），但清空正文 */
    @Update("""
            UPDATE t_comment SET status = 0, body = ''
            WHERE id = #{id} AND status = 1
            """)
    int softDelete(@Param("id") Long id);

    @Update("UPDATE t_comment SET reply_count = reply_count + 1 WHERE id = #{id}")
    int incrementReplyCount(@Param("id") Long id);

    @Update("""
            UPDATE t_comment SET reply_count = reply_count - 1
            WHERE id = #{id} AND reply_count > 0
            """)
    int decrementReplyCount(@Param("id") Long id);

    /**
     * 一批帖子在窗口内新增的可见评论数。
     *
     * <b>只算 status=1</b>：tombstone（status=0）是"已删除但有回复"的占位，
     * 它不该算作新增互动——否则删一条评论反而让热度涨。
     *
     * 按 post_id 分组返回，没出现的帖子由调用方补 0。
     */
    @Select("""
            <script>
            SELECT post_id AS postId, COUNT(*) AS cnt FROM t_comment
            WHERE status = 1 AND created_at &gt;= #{since}
              AND post_id IN
              <foreach collection="postIds" item="pid" open="(" separator="," close=")">#{pid}</foreach>
            GROUP BY post_id
            </script>
            """)
    List<PostCommentCount> recentCommentCounts(@Param("postIds") List<Long> postIds,
                                               @Param("since") LocalDateTime since);

    /** 计数载体。字段名与 SQL 别名一致 */
    record PostCommentCount(Long postId, long cnt) {
    }
}
