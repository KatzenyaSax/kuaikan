package top.katzenyasax.kuaikan.interaction.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.interaction.service.InteractionService;
import top.katzenyasax.kuaikan.interaction.domain.Interaction;
import top.katzenyasax.kuaikan.interaction.mapper.InteractionMapper;
import top.katzenyasax.kuaikan.interaction.web.dto.SinceRequest;
import top.katzenyasax.kuaikan.interaction.web.dto.SinceResponse;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetCount;
import top.katzenyasax.kuaikan.interaction.web.dto.TargetDelta;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    /** 一次最多查多少个目标。超过就拒，不静默截断——截断了调用方会以为算全了 */
    private static final int MAX_TARGETS = 200;

    private final InteractionService interactionService;
    private final InteractionMapper interactionMapper;

    public InternalCountController(InteractionService interactionService,
                                   InteractionMapper interactionMapper) {
        this.interactionService = interactionService;
        this.interactionMapper = interactionMapper;
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

    /**
     * 窗口内增量：这些目标在 since 之后新增了多少赞与收藏。
     *
     * rank 的热度公式用它算 `recent`（强信号走增量）。
     *
     * <b>按 kind 查两次而不是一次查出两种</b>：索引
     * `idx_kind_type_created (kind, target_type, created_at, target_id)`
     * 的第一列就是 kind，去掉它索引前缀就用不上，会整表扫描。
     * 省一次往返不值这个代价。
     */
    @PostMapping("/counts/since")
    public Result<List<SinceResponse>> since(@RequestBody SinceRequest req) {
        List<Long> ids = new ArrayList<>();
        for (String raw : req.targetIds() == null ? List.<String>of() : req.targetIds()) {
            try {
                ids.add(Long.parseLong(raw.trim()));
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "targetIds 里含非法 id");
            }
        }
        if (ids.isEmpty()) {
            return Result.ok(List.of());
        }
        if (ids.size() > MAX_TARGETS) {
            // 不静默截断：截断了调用方会以为算全了，榜单会少算而没人知道
            throw new BizException(CommonErrorCode.PARAM_INVALID,
                    "一次最多查 " + MAX_TARGETS + " 个目标");
        }

        int targetType = "COMMENT".equalsIgnoreCase(req.targetType())
                ? Interaction.TARGET_COMMENT : Interaction.TARGET_POST;
        LocalDateTime since = LocalDateTime.ofInstant(Instant.ofEpochMilli(req.since()),
                ZoneId.systemDefault());

        Map<Long, Long> likes = toMap(interactionMapper.countSince(
                Interaction.KIND_LIKE, targetType, since, ids));
        Map<Long, Long> favorites = toMap(interactionMapper.countSince(
                Interaction.KIND_FAVORITE, targetType, since, ids));

        // 用 LinkedHashMap 保持请求顺序，日志和断言都更好读
        Map<Long, SinceResponse> merged = new LinkedHashMap<>();
        for (Long id : ids) {
            long l = likes.getOrDefault(id, 0L);
            long f = favorites.getOrDefault(id, 0L);
            if (l == 0 && f == 0) {
                continue; // 窗口内零互动就不返回，调用方补 0
            }
            merged.put(id, new SinceResponse(String.valueOf(id), l, f));
        }
        return Result.ok(new ArrayList<>(merged.values()));
    }

    private static Map<Long, Long> toMap(List<TargetDelta> rows) {
        Map<Long, Long> out = new HashMap<>();
        for (TargetDelta r : rows) {
            out.put(r.targetId(), r.cnt());
        }
        return out;
    }
}
