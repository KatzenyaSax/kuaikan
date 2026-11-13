package top.katzenyasax.kuaikan.interaction.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.interaction.domain.OutboxEvent;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface OutboxMapper extends BaseMapper<OutboxEvent> {

    /**
     * 取一批待投递事件。
     *
     * 单实例 + 单线程 @Scheduled 不会并发取到同一批，所以 P3 不需要
     * {@code FOR UPDATE SKIP LOCKED}。P7 上多实例时要么加它、要么加分布式锁。
     */
    @Select("""
            SELECT * FROM t_outbox
            WHERE status = 0 AND next_retry_at <= #{now}
            ORDER BY id ASC
            LIMIT #{limit}
            """)
    List<OutboxEvent> pickPending(@Param("now") LocalDateTime now, @Param("limit") int limit);

    @Update("UPDATE t_outbox SET status = 1 WHERE id = #{id} AND status = 0")
    int markSent(@Param("id") Long id);

    /** 失败：重试次数 +1，并把下次尝试时间推到退避点 */
    @Update("""
            UPDATE t_outbox
            SET retry_count = retry_count + 1, next_retry_at = #{nextRetryAt}
            WHERE id = #{id} AND status = 0
            """)
    int scheduleRetry(@Param("id") Long id, @Param("nextRetryAt") LocalDateTime nextRetryAt);

    @Update("UPDATE t_outbox SET status = 2 WHERE id = #{id} AND status = 0")
    int markAbandoned(@Param("id") Long id);

    /** 已投递的行保留一段时间后清掉，否则表无限增长 */
    @Update("DELETE FROM t_outbox WHERE status = 1 AND created_at < #{before}")
    int purgeDelivered(@Param("before") LocalDateTime before);
}
