package top.katzenyasax.kuaikan.content.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.content.domain.ConsumeLog;

@Mapper
public interface ConsumeLogMapper extends BaseMapper<ConsumeLog> {

    /**
     * 幂等第一道检查。返回 1 = 首次消费；0 = 已经消费过（重复投递）。
     *
     * INSERT IGNORE 依赖 uk_event_consumer 唯一键。用 affectedRows 判断
     * 而不是"先 select 再 insert"——后者在并发下两个线程都会查到不存在。
     */
    @Insert("""
            INSERT IGNORE INTO t_consume_log (id, event_id, consumer, created_at)
            VALUES (#{id}, #{eventId}, #{consumer}, #{createdAt})
            """)
    int insertIgnore(ConsumeLog row);
}
