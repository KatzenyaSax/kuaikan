package top.katzenyasax.kuaikan.interaction.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import top.katzenyasax.kuaikan.interaction.domain.Interaction;

@Mapper
public interface InteractionMapper extends BaseMapper<Interaction> {

    /**
     * 幂等写入：已存在就什么都不做。
     *
     * <b>返回值决定要不要产生事件</b>：
     *   1 = 新插入 → 发 ADDED
     *   0 = 本来就存在 → **不发**（这就是幂等的来源）
     *
     * 和 P2.2 的"加入社群"用 affectedRows 判断计数是同一个手法，
     * 只是这里判断的是"要不要产生事件"。
     */
    @Insert("""
            INSERT IGNORE INTO t_interaction (id, user_id, kind, target_type, target_id, created_at)
            VALUES (#{id}, #{userId}, #{kind}, #{targetType}, #{targetId}, #{createdAt})
            """)
    int insertIgnore(Interaction row);

    /**
     * 取消（物理删）。返回 1 才是真的删掉了 → 才发 REMOVED。
     *
     * 物理删而不是软删：接口语义是"设为未赞"，"没有这一行"就是唯一的事实。
     * 软删会让唯一键表达"曾经赞过"，还得写复活逻辑，而历史对业务毫无用处。
     */
    @Delete("""
            DELETE FROM t_interaction
            WHERE user_id = #{userId} AND kind = #{kind}
              AND target_type = #{targetType} AND target_id = #{targetId}
            """)
    int deleteByUnique(@Param("userId") Long userId,
                       @Param("kind") Integer kind,
                       @Param("targetType") Integer targetType,
                       @Param("targetId") Long targetId);
}
