package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.community.domain.CommunityMember;

import java.time.LocalDateTime;

@Mapper
public interface CommunityMemberMapper extends BaseMapper<CommunityMember> {

    /**
     * 复活：把已退出的行重新置为在社。**返回 1 才是"真的复活了"**。
     *
     * 为什么用"先 insert、撞键再调这个"而不是一条 ON DUPLICATE KEY UPDATE：
     * upsert 需要自己先分配雪花 id，那就得注入 IdentifierGenerator；而
     * MyBatis-Plus 的生成器是挂在 GlobalConfig 上的，不一定以 bean 形式暴露。
     * 更关键的是——**自己生成 id 有绕开 compose 里 ID_WORKER_ID 分配的风险**，
     * 而 worker-id 冲突要等到写入时才暴露。
     *
     * 让 BaseMapper.insert 去分配 id，就等于沿用了服务级配置。
     *
     * 并发安全：两个请求同时加入时，一个 insert 成功、另一个撞唯一键后落到这里，
     * updated=0（本来就是 active）→ 不会重复计数。真正由唯一键做裁判，
     * 不是"先查再插"那种会产生竞态的写法。
     */
    @Update("""
            UPDATE t_community_member SET status = 1, joined_at = #{joinedAt}
            WHERE community_id = #{communityId} AND user_id = #{userId} AND status = 0
            """)
    int revive(@Param("communityId") Long communityId,
               @Param("userId") Long userId,
               @Param("joinedAt") LocalDateTime joinedAt);

    /** 退出（幂等）。返回 1 才是真的从"在社"变成"已退出"，才需要 member_count -1 */
    @Update("""
            UPDATE t_community_member SET status = 0
            WHERE community_id = #{communityId} AND user_id = #{userId} AND status = 1
            """)
    int markLeft(@Param("communityId") Long communityId, @Param("userId") Long userId);
}
