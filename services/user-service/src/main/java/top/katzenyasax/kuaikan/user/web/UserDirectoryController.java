package top.katzenyasax.kuaikan.user.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import top.katzenyasax.kuaikan.common.api.Result;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.web.annotation.PublicEndpoint;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.UserSummary;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 批量用户摘要。游客可读。
 *
 * 为什么需要它：帖子与评论**不存作者昵称头像快照**（ADR 0009），只存 author_id。
 * 一屏 20 个帖子来自最多 20 个作者，逐个查就是 20 次请求，所以必须有批量接口。
 *
 * 三条约束写死在这里，不要放宽：
 *   1. **只返回 userId / nickname / avatarUrl**（见 UserSummary）
 *   2. **单次最多 100 个 id** —— 它长得像"用户目录"，不设上限就等于开放拖库
 *   3. **不存在的 id 直接不返回**，不报错 —— 调用方按需自行降级为"已注销用户"
 */
@RestController
public class UserDirectoryController {

    private static final int MAX_IDS = 100;

    private final UserMapper userMapper;

    public UserDirectoryController(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @PublicEndpoint
    @GetMapping("/users")
    public Result<List<UserSummary>> batch(@RequestParam("ids") String ids) {
        List<Long> parsed = parseIds(ids);
        if (parsed.isEmpty()) {
            return Result.ok(List.of());
        }
        List<User> users = userMapper.selectByIds(parsed);
        List<UserSummary> out = new ArrayList<>(users.size());
        for (User user : users) {
            // 已删除的账号不返回，让前端降级成"已注销用户"
            if (user.getDeletedAt() == null) {
                out.add(UserSummary.of(user));
            }
        }
        return Result.ok(out);
    }

    private static List<Long> parseIds(String raw) {
        // LinkedHashSet 去重且保序：重复 id 不该让返回条数变多，也不该让顺序乱掉
        Set<Long> unique = new LinkedHashSet<>();
        for (String part : raw.split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                unique.add(Long.parseLong(trimmed));
            } catch (NumberFormatException e) {
                throw new BizException(CommonErrorCode.PARAM_INVALID, "ids 必须是逗号分隔的数字");
            }
            if (unique.size() > MAX_IDS) {
                throw new BizException(CommonErrorCode.PARAM_INVALID,
                        "单次最多查询 " + MAX_IDS + " 个用户");
            }
        }
        return new ArrayList<>(unique);
    }
}
