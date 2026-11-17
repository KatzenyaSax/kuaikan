package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.community.domain.Community;
import top.katzenyasax.kuaikan.community.mapper.CommunityMapper;
import top.katzenyasax.kuaikan.community.web.dto.CommunityRef;

/**
 * 内部：社群 id -> 名字。
 *
 * 只有一个用途：notification 拼消息快照时需要社群名，
 * 否则消息点不进帖子页（帖子路由是 `/c/{社群名}/p/{帖子id}`，用的是名字不是 id）。
 *
 * 网关不路由 {@code /internal/**}，所以它不在公网可见面上。
 */
@Hidden
@RestController
@RequestMapping("/internal")
public class InternalCommunityController {

    private final CommunityMapper communityMapper;

    public InternalCommunityController(CommunityMapper communityMapper) {
        this.communityMapper = communityMapper;
    }

    @GetMapping("/communities/{id}")
    public Result<CommunityRef> byId(@PathVariable("id") Long id) {
        Community c = communityMapper.selectById(id);
        // 已删除的社群对外一律"不存在"，与详情接口语义一致
        if (c == null || c.getStatus() != Community.STATUS_NORMAL) {
            return Result.ok(CommunityRef.missing());
        }
        return Result.ok(CommunityRef.of(c.getName()));
    }
}
