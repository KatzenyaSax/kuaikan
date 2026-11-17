package top.katzenyasax.kuaikan.common.outbox;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

/**
 * `t_outbox` 的读写。
 *
 * ⚠️ <b>使用方必须把本包纳入 Mapper 扫描</b>。这个类不在各服务的
 * {@code @SpringBootApplication} 包下，MyBatis-Plus 的自动扫描找不到它。
 *
 * 正确做法是在服务的启动类上显式声明：
 * <pre>
 * &#64;MapperScan({"top.katzenyasax.kuaikan.content.mapper",
 *              "top.katzenyasax.kuaikan.common.outbox"})
 * </pre>
 *
 * 注意加上 {@code @MapperScan} 会**关掉 MyBatis-Plus 的自动扫描**
 * （它带 {@code @ConditionalOnMissingBean(MapperScannerConfigurer.class)}），
 * 所以服务自己的 mapper 包也必须一起列进去，漏了会在启动时报找不到 Mapper。
 *
 * 失败是响亮的（启动期 NoSuchBeanDefinitionException），不是静默的 ——
 * 这也是没在 auto-config 里替使用者做扫描的原因：那会让上面这条依赖关系变成隐式的。
 */
@Mapper
public interface OutboxMapper extends BaseMapper<OutboxEvent> {

    /**
     * 取一批待投递事件。
     *
     * 单实例 + 单线程 {@code @Scheduled} 不会并发取到同一批，所以目前不需要
     * {@code FOR UPDATE SKIP LOCKED}。上多实例时要么加它、要么加分布式锁。
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
