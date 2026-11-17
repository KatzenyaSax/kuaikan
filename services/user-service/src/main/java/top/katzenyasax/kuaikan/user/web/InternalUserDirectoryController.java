package top.katzenyasax.kuaikan.user.web;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.UserSummary;

import java.util.ArrayList;
import java.util.List;

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
}
