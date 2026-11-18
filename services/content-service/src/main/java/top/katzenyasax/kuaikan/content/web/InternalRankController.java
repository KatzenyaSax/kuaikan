package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.service.RankCandidateService;
import top.katzenyasax.kuaikan.content.web.dto.RankCandidate;

import java.util.List;

/**
 * 内部：给 rank-service 提供候选帖。
 *
 * 网关不路由 {@code /internal/**}，只有容器网络能到。
 *
 * <b>为什么是"候选"而不是"榜单"</b>：content 只负责按窗口筛出有资格的帖子
 * 并给出原始计数，**打分与排序完全在 rank 里**。把排序放进 content，
 * 就等于让 content 知道热度公式，而公式是要独立演进、独立调参的。
 */
@Hidden
@RestController
@RequestMapping("/internal/rank")
public class InternalRankController {

    private final RankCandidateService service;

    public InternalRankController(RankCandidateService service) {
        this.service = service;
    }

    /**
     * @param since 窗口起点，epoch 毫秒。**必填**：不传就等于要全表，那是调用方的问题不该被默默接受
     * @param cursor 上一页最后一个 postId；首页不传
     */
    @GetMapping("/candidates")
    public Result<List<RankCandidate>> candidates(@RequestParam("since") long since,
                                                  @RequestParam(value = "cursor", required = false) Long cursor,
                                                  @RequestParam(value = "limit", required = false) Integer limit) {
        return Result.ok(service.candidates(since, cursor, limit));
    }
}
