package top.katzenyasax.kuaikan.community.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.community.domain.Community;
import top.katzenyasax.kuaikan.community.mapper.CommunityMapper;
import top.katzenyasax.kuaikan.community.web.dto.BatchCommunitiesRequest;
import top.katzenyasax.kuaikan.community.web.dto.CommunityNameView;
import top.katzenyasax.kuaikan.community.web.dto.CommunityRef;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

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

    /** 内部批量查询上限，与 content 的 by-authors、user 的 batch 对齐 */
    private static final int MAX_BATCH_IDS = 200;

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

    /**
     * 内部：按 id 批量取 id + name（P6.1）。
     *
     * 全量重建时一批帖子会涉及多个社群，逐个调 {@code GET /communities/{id}}
     * 就是 N+1；单条消费也复用本接口，减少端点膨胀（p6-search.md §3.2）。
     *
     * <b>已删除 / 不存在的 id 直接不返回</b>，不报错 —— 内部查询接口
     * 回答「是什么」而不是「做什么」。空 body / 空列表返回空列表；
     * 超过 200 个或含非法 id 一律 40010。
     */
    @PostMapping("/communities/batch")
    public Result<List<CommunityNameView>> batch(
            @RequestBody(required = false) BatchCommunitiesRequest body) {
        List<Long> ids = parseIds(body == null ? null : body.ids());
        if (ids.isEmpty()) {
            return Result.ok(List.of());
        }
        List<Community> communities = communityMapper.selectByIds(ids);
        List<CommunityNameView> out = new ArrayList<>(communities.size());
        for (Community community : communities) {
            if (community.getStatus() != null && community.getStatus() == Community.STATUS_NORMAL) {
                out.add(CommunityNameView.of(community));
            }
        }
        return Result.ok(out);
    }

    /** 字符串雪花 id → 正 Long，去重保序，超过上限报 40010 */
    private static List<Long> parseIds(List<String> raw) {
        Set<Long> unique = new LinkedHashSet<>();
        if (raw == null) {
            return List.of();
        }
        for (String part : raw) {
            if (part == null || part.isBlank()) {
                continue;
            }
            long id;
            try {
                id = Long.parseLong(part.trim());
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "社群 id 里含非法值");
            }
            if (id <= 0) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "社群 id 里含非法值");
            }
            unique.add(id);
            if (unique.size() > MAX_BATCH_IDS) {
                throw new BizException(CommonErrorCode.PARAM_INVALID,
                        "单次最多查询 " + MAX_BATCH_IDS + " 个社群");
            }
        }
        return new ArrayList<>(unique);
    }
}
