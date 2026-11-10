package top.katzenyasax.kuaikan.user.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.user.domain.User;

@Mapper
public interface UserMapper extends BaseMapper<User> {
}
