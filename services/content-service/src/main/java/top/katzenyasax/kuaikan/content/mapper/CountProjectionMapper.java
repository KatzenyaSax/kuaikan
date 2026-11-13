package top.katzenyasax.kuaikan.content.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

/**
 * 计数投影：消费事件时增量修改派生计数。
 *
 * 全部是**相对更新** + 下界保护：
 *   - 相对更新避免丢更新（两个消费者读到同一个旧值再各自写）
 *   - `> 0` 保护避免一条重复的 REMOVED 把计数减成负数回绕
 *     （重复投递理论上会被 t_consume_log 挡住，但保护要留——
 *     对账能修，但显示成 42 亿是肉眼可见的事故）
 */
@Mapper
public interface CountProjectionMapper {

    @Update("UPDATE t_post SET like_count = like_count + #{delta} WHERE id = #{id} AND like_count + #{delta} >= 0")
    int applyPostLike(@Param("id") Long id, @Param("delta") int delta);

    @Update("UPDATE t_post SET favorite_count = favorite_count + #{delta} WHERE id = #{id} AND favorite_count + #{delta} >= 0")
    int applyPostFavorite(@Param("id") Long id, @Param("delta") int delta);

    @Update("UPDATE t_comment SET like_count = like_count + #{delta} WHERE id = #{id} AND like_count + #{delta} >= 0")
    int applyCommentLike(@Param("id") Long id, @Param("delta") int delta);
}
