package top.katzenyasax.kuaikan.rank.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.rank.config.RankProperties;
import top.katzenyasax.kuaikan.rank.service.RankRebuildService;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 内部运维端点：立即重建热榜。
 *
 * <b>为什么需要它</b>：
 * <ul>
 *   <li>调完权重或半衰期后想立刻看到效果，而不是等 5 分钟</li>
 *   <li>验收脚本要能"改一个数 → 重建 → 断言排序变了"，
 *       否则每条断言都得等一个重建周期，整套验收变成十几分钟</li>
 * </ul>
 *
 * 网关不路由 {@code /internal/**}，只能在容器网络内调用。
 * 它**不返回数据**，只报告每个榜是成功还是失败——重建失败时旧版本仍然生效。
 */
@Hidden
@RestController
@RequestMapping("/internal/admin")
public class InternalAdminController {

    private final RankRebuildService rebuildService;
    private final RankProperties props;

    public InternalAdminController(RankRebuildService rebuildService, RankProperties props) {
        this.rebuildService = rebuildService;
        this.props = props;
    }

    @PostMapping("/rebuild")
    public Result<Map<String, Boolean>> rebuild() {
        Map<String, Boolean> out = new LinkedHashMap<>();
        // 两个榜独立重建：一个失败不影响另一个（与定时任务的行为一致）
        out.put("day", rebuildService.rebuild("day", props.getDayHalfLifeHours()));
        out.put("week", rebuildService.rebuild("week", props.getWeekHalfLifeHours()));
        return Result.ok(out);
    }
}
