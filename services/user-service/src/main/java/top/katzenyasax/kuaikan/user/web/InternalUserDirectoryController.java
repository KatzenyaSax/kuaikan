package top.katzenyasax.kuaikan.user.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.BatchUsersRequest;
import top.katzenyasax.kuaikan.user.web.dto.InternalUserView;
import top.katzenyasax.kuaikan.user.web.dto.UserSummary;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 内部：把昵称变成 userId。给 content 解析评论正文里的 `@昵称` 用（P4.1）。
 *
 * <b>为什么必须是 /internal/</b>：按昵称查人一旦公开，等于开放**全站用户枚举** ——
 * 任何人都能用昵称碰撞出账号列表。公网只允许按 id 批量取摘要。
 *
 * 网关不路由 {@code /internal/**}，所以它不在公网可见面上，也不需要 @PublicEndpoint。
 *
 * <b>返回的永远是"成功"</b>：查不到就是空数组，不是 404。
 * 内部查询接口回答"是什么"，不是"做什么"（同 P2.3 的 memberships）。
 */
@Hidden
@RestController
@RequestMapping("/internal/users")
public class InternalUserDirectoryController {

    /** 一次最多解析多少个候选。正文里出现 20 个 @ 已经不正常了 */
    private static final int MAX_NAMES = 20;

    /**
     * 内部批量取昵称的上限，与 content 的 by-authors 对齐：
     * 一批索引回填最多收集 200 个作者。
     */
    private static final int MAX_BATCH_IDS = 200;

    private final UserMapper userMapper;

    public InternalUserDirectoryController(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    /**
     * @param names 逗号分隔的昵称，精确匹配（不做模糊）
     */
    @GetMapping("/by-nicknames")
    public Result<List<UserSummary>> byNicknames(@RequestParam("names") String names) {
        List<String> parsed = new ArrayList<>();
        for (String raw : names.split(",")) {
            String n = raw.trim();
            if (!n.isEmpty() && parsed.size() < MAX_NAMES && !parsed.contains(n)) {
                parsed.add(n);
            }
        }
        if (parsed.isEmpty()) {
            return Result.ok(List.of());
        }

        // 昵称没有唯一约束，同一个昵称可能命中多行。按 id 升序返回，
        // 调用方取第一条即"重名取 userId 最小"——规则在调用方，不在存储层。
        List<User> users = userMapper.selectByNicknames(parsed);
        List<UserSummary> out = new ArrayList<>(users.size());
        for (User user : users) {
            out.add(UserSummary.of(user));
        }
        return Result.ok(out);
    }

    /**
     * 内部：按 id 批量取 id + nickname（P6.1，给 search-service 补齐 {@code authorNickname}）。
     *
     * <b>为什么单条消费也走批量</b>：索引回填一次要补一批作者，单条查会造成 N+1；
     * 为两种情况各开一个端点只会让调用方面临「什么时候用哪个」的选择（p6-search.md §3.2）。
     *
     * <b>不存在的 id 直接不返回</b>，不报错：内部查询接口回答「是什么」而不是「做什么」，
     * 调用方按需降级成「已注销用户」。已删除账号同样不返回。
     *
     * 空 body / 空列表返回空列表；超过 200 个或含非法 id 一律 40010。
     */
    @PostMapping("/batch")
    public Result<List<InternalUserView>> batch(
            @RequestBody(required = false) BatchUsersRequest body) {
        List<Long> ids = parseIds(body == null ? null : body.ids());
        if (ids.isEmpty()) {
            return Result.ok(List.of());
        }
        List<User> users = userMapper.selectByIds(ids);
        List<InternalUserView> out = new ArrayList<>(users.size());
        for (User user : users) {
            // 已删除的账号不返回，让调用方降级成「已注销用户」
            if (user.getDeletedAt() == null) {
                out.add(InternalUserView.of(user));
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
                throw new BizException(CommonErrorCode.PARAM_INVALID, "用户 id 里含非法值");
            }
            if (id <= 0) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "用户 id 里含非法值");
            }
            unique.add(id);
            if (unique.size() > MAX_BATCH_IDS) {
                throw new BizException(CommonErrorCode.PARAM_INVALID,
                        "单次最多查询 " + MAX_BATCH_IDS + " 个用户");
            }
        }
        return new ArrayList<>(unique);
    }
}
