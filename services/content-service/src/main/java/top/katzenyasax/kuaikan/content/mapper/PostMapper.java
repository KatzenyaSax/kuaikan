package top.katzenyasax.kuaikan.content.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
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
}
