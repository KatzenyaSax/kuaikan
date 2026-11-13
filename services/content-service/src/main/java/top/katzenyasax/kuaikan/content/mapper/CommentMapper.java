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
}
