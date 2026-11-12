package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.community.domain.Community;

@Mapper
public interface CommunityMapper extends BaseMapper<Community> {

    /**
     * 按名称取社群并**加行锁**，用于所有会改动成员关系的写路径。
     *
     * 为什么必须加锁：加入/退出的流程是"改成员行 + 改 member_count"两条语句，
     * 而"加入"的第一步是插入成员行——如果同一 (社群,用户) 已存在，这次 insert
     * 会因唯一键失败，**InnoDB 会在失败的索引记录上留下共享锁**。两个并发事务
     * 各持一个 S 锁、又都想把它升级成 X 锁，就是死锁。
     *
     * 抓到的现场：10 个并发加入触发
     * `DeadlockLoserDataAccessException ... CommunityMemberMapper.revive`。
     *
     * 解法不是加重试，而是**给所有成员变更事务一个统一的、最先获取的锁点**：
     * 社群行。这样同一社群的加入/退出被串行化，锁顺序固定，不可能成环。
     * 加入社群是低频操作，串行化的代价可以忽略。
     */
    @Select("""
            SELECT * FROM t_community
            WHERE name_key = #{nameKey} AND status = 1
            FOR UPDATE
            """)
    Community selectByNameKeyForUpdate(@Param("nameKey") String nameKey);

    /**
     * 成员数 +1。
     *
     * <b>相对更新，绝不读-改-写</b>：先 SELECT 再 UPDATE 在并发下会丢更新
     * （两个请求都读到 5、都写 6，实际加进来 2 个成员）。
     */
    @Update("UPDATE t_community SET member_count = member_count + 1 WHERE id = #{id}")
    int incrementMemberCount(@Param("id") Long id);

    /**
     * 成员数 -1。带 {@code member_count > 0} 保护：
     * 脏数据或重复扣减时不至于把无符号列减到回绕成 42 亿。
     */
    @Update("""
            UPDATE t_community SET member_count = member_count - 1
            WHERE id = #{id} AND member_count > 0
            """)
    int decrementMemberCount(@Param("id") Long id);
}
