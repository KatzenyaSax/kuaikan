package top.katzenyasax.kuaikan.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import top.katzenyasax.kuaikan.community.domain.CommunityHistory;

/**
 * 社群历史。**只插入 + 读**，没有任何 update/delete 方法。
 *
 * 查询全部走 LambdaQueryWrapper（三个组合各对应 V2 里的一条索引：
 * (community_id, created_at, id) / (community_id, category, created_at, id) /
 * (community_id, event_type, created_at, id)），这里不写自定义 SQL。
 */
@Mapper
public interface CommunityHistoryMapper extends BaseMapper<CommunityHistory> {
}
