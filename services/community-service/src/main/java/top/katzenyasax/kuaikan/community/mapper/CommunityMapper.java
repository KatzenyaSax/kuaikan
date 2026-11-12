package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
import top.katzenyasax.kuaikan.community.domain.Community;

@Mapper
public interface CommunityMapper extends BaseMapper<Community> {

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
