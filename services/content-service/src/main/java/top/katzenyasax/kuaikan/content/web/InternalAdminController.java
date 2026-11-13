package top.katzenyasax.kuaikan.content.web;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.content.service.CountReconciler;

import java.util.Map;

/**
 * 运维端点：手动触发一次计数对账。
 *
 * 只在 {@code /internal/**} 下，网关不路由，所以只能 {@code docker exec} 调
 * ——与 P1.4 的 kick/ban 同一个先例。
 *
 * 没有它就只能等 10 分钟的定时任务，L4 的"对账修错"断言会慢到没人愿意跑。
 */
@RestController
@RequestMapping("/internal/admin")
public class InternalAdminController {

    private final CountReconciler countReconciler;

    public InternalAdminController(CountReconciler countReconciler) {
        this.countReconciler = countReconciler;
    }

    @Operation(operationId = "reconcileCounts")
    @PostMapping("/reconcile")
    public Result<Map<String, Object>> reconcile() {
        return Result.ok(countReconciler.reconcileAll());
    }
}
