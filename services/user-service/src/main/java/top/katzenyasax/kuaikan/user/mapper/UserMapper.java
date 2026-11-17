package top.katzenyasax.kuaikan.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import top.katzenyasax.kuaikan.user.domain.User;

import java.util.Collection;
import java.util.List;

@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * 按昵称精确查人。给 content 解析 `@昵称` 用（P4.1）。
     *
     * <b>为什么不用 LambdaQueryWrapper 拼 in</b>：昵称是用户输入，直接拼会有注入面；
     * 这里用 {@code IN} 参数绑定，语义与一次性查多个同义。
     *
     * <b>为什么不加 LIMIT</b>：调用方（content）每次只传正文里出现的 1~3 个候选。
     * 昵称没有唯一约束，同一个昵称可能有多行——这正是"重名取 userId 最小"那条规则要处理的。
     */
    @Select("""
            <script>
            SELECT * FROM t_user
            WHERE deleted_at IS NULL AND status = 1
              AND nickname IN
              <foreach collection="nicknames" item="n" open="(" separator="," close=")">#{n}</foreach>
            ORDER BY id ASC
            </script>
            """)
    List<User> selectByNicknames(@Param("nicknames") Collection<String> nicknames);
}
