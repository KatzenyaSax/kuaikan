package top.katzenyasax.kuaikan.content.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 对账用的读写。只用 content 自己的库——事实表在 interaction 那边，
 * 通过内部接口取（ADR 0006 一库一账号）。
 */
@Mapper
public interface CountReconcileMapper {

    /** 按 id 游标分页取帖子 id。不用 OFFSET：大表上 OFFSET 会越来越慢 */
    @Select("SELECT id FROM t_post WHERE id > #{cursor} ORDER BY id ASC LIMIT #{limit}")
    List<Long> pagePostIds(@Param("cursor") long cursor, @Param("limit") int limit);

    @Select("SELECT id FROM t_comment WHERE id > #{cursor} ORDER BY id ASC LIMIT #{limit}")
    List<Long> pageCommentIds(@Param("cursor") long cursor, @Param("limit") int limit);

    /**
     * 覆盖写帖子的计数。
     *
     * favoriteCount 传 null 表示"这次不算收藏"（当前总会传值，
     * 留这个分支是为了将来只对某一列做对账时不用改签名）。
     */
    @Update("""
            <script>
            UPDATE t_post
            SET like_count = #{likeCount}
            <if test="favoriteCount != null">, favorite_count = #{favoriteCount}</if>
            WHERE id = #{id}
            </script>
            """)
    int overwritePostCounts(@Param("id") Long id,
                            @Param("likeCount") long likeCount,
                            @Param("favoriteCount") Long favoriteCount);

    @Update("UPDATE t_comment SET like_count = #{likeCount} WHERE id = #{id}")
    int overwriteCommentLikeCount(@Param("id") Long id, @Param("likeCount") long likeCount);
}
