package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.community.domain.Community;

@Mapper
public interface CommunityMapper extends BaseMapper<Community> {
}
