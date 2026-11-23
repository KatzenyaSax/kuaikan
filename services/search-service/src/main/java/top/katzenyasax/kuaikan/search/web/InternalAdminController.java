package top.katzenyasax.kuaikan.search.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.search.service.SearchRebuildService;
import top.katzenyasax.kuaikan.search.web.dto.RebuildResult;

/**
 * 内部运维端点：零停机全量重建索引（p6-search.md §4.3）。
 *
 * <b>为什么需要它</b>：
 * <ul>
 *   <li>首次上线 / 换 mapping 后要把存量帖灌进 ES</li>
 *   <li>事件曾经漏消费（ES 停机超过重投上限）时，全量重建是唯一自愈手段</li>
 *   <li>验收脚本要能"重建 → 断言存量帖全部可搜"，而不是干等事件</li>
 * </ul>
 *
 * 网关不路由 {@code /internal/**}（InternalPathBlockFilter），所以只能在容器网络内调用，
 * 不需要 {@code @PublicEndpoint}。用 {@code @Hidden}：它不是前端契约的一部分，
 * 不进 OpenAPI spec（P6.3 的对外检索契约才是）。
 *
 * <b>失败语义</b>：重建在别名切换前失败时，新索引会被清理，旧索引继续服务；
 * 失败以异常形式冒到全局异常处理器（HTTP 500 + 统一错误码），
 * 不会返回一个"看起来成功但索引是空的"结果。
 */
@Hidden
@RestController
@RequestMapping("/internal/admin")
public class InternalAdminController {

    private final SearchRebuildService rebuildService;

    public InternalAdminController(SearchRebuildService rebuildService) {
        this.rebuildService = rebuildService;
    }

    @PostMapping("/rebuild")
    public Result<RebuildResult> rebuild() {
        return Result.ok(rebuildService.rebuild());
    }
}
