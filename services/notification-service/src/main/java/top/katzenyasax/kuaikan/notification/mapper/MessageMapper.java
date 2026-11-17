package top.katzenyasax.kuaikan.notification.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.notification.domain.Message;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface MessageMapper extends BaseMapper<Message> {

    /**
     * 幂等写入。返回 1 = 这条消息是新的；0 = 同一事件对同一人已经发过了。
     *
     * <b>这是全项目唯一走"唯一索引档"的幂等</b>（架构 §6 的第一档）：
     * 去重键与被保护的数据在同一行，一次 INSERT 就完成全部工作。
     * content 侧改 like_count 走不了这档，因为它的去重键要保护另一张表的行，
     * 只能靠 t_consume_log 去重表。
     *
     * 用 INSERT IGNORE + affectedRows 而不是"先 select 再 insert"：
     * 后者在并发下两个线程都会查到不存在。
     */
    @Insert("""
            INSERT IGNORE INTO t_message
              (id, user_id, type, source_event_id, actor_id, actor_nickname, actor_avatar,
               target_type, target_id, target_title, community_name, post_id, comment_id,
               root_comment_id, excerpt, read_at, created_at)
            VALUES
              (#{id}, #{userId}, #{type}, #{sourceEventId}, #{actorId}, #{actorNickname}, #{actorAvatar},
               #{targetType}, #{targetId}, #{targetTitle}, #{communityName}, #{postId}, #{commentId},
               #{rootCommentId}, #{excerpt}, #{readAt}, #{createdAt})
            """)
    int insertIgnore(Message row);

    /**
     * 四类未读一次查完。
     *
     * <b>不用 Redis 计数器</b>：那套"允许漂移 + 每日对账"是为写多读多的点赞数付的代价。
     * 未读数读远比写频繁、量又小，直接算更准确，而且"全部已读"没有吞消息的竞态。
     * 详见 docs/design/p4-notification.md §6.5。
     */
    @Select("""
            SELECT type, COUNT(*) AS cnt FROM t_message
            WHERE user_id = #{userId} AND read_at IS NULL
            GROUP BY type
            """)
    List<TypeCount> countUnreadByType(@Param("userId") Long userId);

    /**
     * 全部已读。
     *
     * <b>这条语句没有竞态</b>：并发到达的新消息要么落在 UPDATE 之前（一起被标已读，
     * 一致），要么落在之后（保持未读，一致）。Redis 计数器方案的 SET 0 会把它抹掉。
     */
    @Update("UPDATE t_message SET read_at = #{now} WHERE user_id = #{userId} AND read_at IS NULL")
    int markAllRead(@Param("userId") Long userId, @Param("now") LocalDateTime now);

    /**
     * 标记单条已读。
     *
     * <b>必须带 user_id 条件</b>：id 是雪花值，理论上猜不到，但"猜不到"不是访问控制。
     * 少了这个条件，任何人可以标任意人的消息已读（虽然无害，但那是越权）。
     *
     * {@code read_at IS NULL} 让重复点击变成 no-op —— 返回 0 不是错误。
     */
    @Update("""
            UPDATE t_message SET read_at = #{now}
            WHERE id = #{id} AND user_id = #{userId} AND read_at IS NULL
            """)
    int markRead(@Param("userId") Long userId,
                 @Param("id") Long id,
                 @Param("now") LocalDateTime now);

    /** 一条 count 的小载体 */
    record TypeCount(String type, long cnt) {
    }
}
