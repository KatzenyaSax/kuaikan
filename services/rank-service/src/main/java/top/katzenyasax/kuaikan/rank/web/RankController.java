package top.katzenyasax.kuaikan.rank.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.rank.service.RankQueryService;
import top.katzenyasax.kuaikan.rank.web.dto.HotPage;

/**
 * 热榜读接口。
 *
 * <b>注意路径不带 {@code /api/rank} 前缀</b>：网关给每个服务配了 `StripPrefix=2`，
 * `/api/rank` 那一层在网关就被剥掉了。写全路径的后果是所有端点静默 404
 * （P4.2 在 notification 上踩过两次，方向相反但结果同一个 500）。
 */
@Tag(name = "热榜")
@RestController
public class RankController {

    private final RankQueryService queryService;

    public RankController(RankQueryService queryService) {
        this.queryService = queryService;
    }

    /**
     * @param range day 或 week。未知值明确拒绝，不静默降级成 day——
     *              静默降级会把前端的 bug 藏起来
     */
    @Operation(operationId = "hotRank", summary = "热榜（Top 50，不分页）")
    @PublicEndpoint
    @GetMapping("/hot")
    public Result<HotPage> hot(@RequestParam(value = "range", required = false) String range) {
        String r = (range == null || range.isBlank()) ? "day" : range.trim().toLowerCase();
        if (!"day".equals(r) && !"week".equals(r)) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "range 只能是 day 或 week");
        }
        return Result.ok(queryService.read(r));
    }
}
