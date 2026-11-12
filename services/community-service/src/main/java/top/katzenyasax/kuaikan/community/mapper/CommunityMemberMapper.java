package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.community.domain.CommunityMember;

@Mapper
public interface CommunityMemberMapper extends BaseMapper<CommunityMember> {

    /**
     * 加入社群（幂等）。**返回值决定 member_count 要不要 +1**：
     *
     * <pre>
     *   1 = 新插入        → +1
     *   2 = 复活（0→1）   → +1   行数没变，但成员数增加了
     *   0 = 本来就是成员   → 不动
     * </pre>
     *
     * 为什么必须 upsert 而不是"先查再插"或 DELETE+INSERT：
     * `uk_community_user` 让同一个 (社群, 用户) 只能有一行；退出用软删（status=0）
     * 保留这一行，所以"退出再加入"必须是复活而不是插入。
     * 先查再插在并发下会两个请求都查到"不存在"，然后一个成功一个撞唯一键。
     *
     * joined_at 用参数传而不是 VALUES()——MySQL 8.0.20 起 VALUES() 已废弃。
     */
    @Insert("""
            INSERT INTO t_community_member (id, community_id, user_id, role, status, joined_at)
            VALUES (#{id}, #{communityId}, #{userId}, #{role}, 1, #{joinedAt})
            ON DUPLICATE KEY UPDATE status = 1, joined_at = #{joinedAt}
            """)
    int upsertActive(CommunityMember member);

    /** 退出社群（幂等）。返回 1 才是真的从"在社"变成"已退出"，才需要 member_count -1 */
    @Update("""
            UPDATE t_community_member SET status = 0
            WHERE community_id = #{communityId} AND user_id = #{userId} AND status = 1
            """)
    int markLeft(@Param("communityId") Long communityId, @Param("userId") Long userId);
}
