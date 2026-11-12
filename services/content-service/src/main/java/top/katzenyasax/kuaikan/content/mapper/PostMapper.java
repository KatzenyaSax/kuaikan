package top.katzenyasax.kuaikan.content.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.content.domain.Post;

@Mapper
public interface PostMapper extends BaseMapper<Post> {
}
