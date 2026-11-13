package top.katzenyasax.kuaikan.interaction.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.interaction.service.InteractionService;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetCount;

import java.util.ArrayList;
import java.util.List;

/**
 * 内部接口：这些目标的**事实计数**是多少。
 *
 * content 的对账任务用它覆盖自己的派生计数。
 *
 * <b>为什么由 interaction 提供而不是 content 直接读 t_interaction</b>：
 * ADR 0006 规定一库一账号，content 的账号对 interaction 的库没有任何权限。
 * 强行开一个跨库只读授权，等于把"每个表只有一个所有者"这条边界破掉——
 * 那正是当初分 schema 的全部意义。
 *
 * 所以真值由所有者（interaction）提供，写入由所有者（content 的计数列）执行。
 * 中间多一次 HTTP，但边界是干净的。
 */
@RestController
@RequestMapping("/internal")
public class InternalCountController {

    private final InteractionService interactionService;

    public InternalCountController(InteractionService interactionService) {
        this.interactionService = interactionService;
    }

    @GetMapping("/counts")
    public Result<List<TargetCount>> counts(@RequestParam("targets") String targets) {
        List<String> list = new ArrayList<>();
        for (String part : targets.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) {
                list.add(t);
            }
        }
        return Result.ok(interactionService.counts(list));
    }
}
