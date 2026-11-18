package top.katzenyasax.kuaikan.interaction.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import top.katzenyasax.kuaikan.interaction.domain.Interaction;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetDelta;

import java.time.LocalDateTime;
import java.util.List;

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

    /**
     * 窗口内新增的某种互动数，按目标分组。
     *
     * <b>必须在 WHERE 里带上 kind 和 target_type</b>：这样正好命中
     * {@code idx_kind_type_created (kind, target_type, created_at, target_id)} 的前缀，
     * 范围扫描只覆盖窗口内的行。
     *
     * 如果去掉 kind 条件、想一次查出两种 kind，索引的第一列就用不上了，
     * 会退化成整表扫描——所以调用方按 kind 调两次，不图省一次往返。
     *
     * `target_id IN (...)` 在 created_at 这个范围列之后，所以它只起过滤作用、
     * 不能被索引定位。这是有意的：窗口内的行本来就都要读，
     * 而所有这些列都在索引里，查询是**覆盖扫描**，不回表。
     */
    @Select("""
            <script>
            SELECT target_id AS targetId, COUNT(*) AS cnt FROM t_interaction
            WHERE kind = #{kind} AND target_type = #{targetType} AND created_at &gt;= #{since}
              AND target_id IN
              <foreach collection="targetIds" item="tid" open="(" separator="," close=")">#{tid}</foreach>
            GROUP BY target_id
            </script>
            """)
    List<TargetDelta> countSince(@Param("kind") Integer kind,
                                 @Param("targetType") Integer targetType,
                                 @Param("since") LocalDateTime since,
                                 @Param("targetIds") List<Long> targetIds);
}
