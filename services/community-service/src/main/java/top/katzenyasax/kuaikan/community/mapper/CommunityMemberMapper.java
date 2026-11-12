package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.community.domain.CommunityMember;

@Mapper
public interface CommunityMemberMapper extends BaseMapper<CommunityMember> {
}
