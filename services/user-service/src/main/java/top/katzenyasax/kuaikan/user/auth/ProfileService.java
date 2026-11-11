package top.katzenyasax.kuaikan.user.auth;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.UpdateProfileRequest;
import top.katzenyasax.kuaikan.user.web.dto.UserProfile;

/**
 * 用户修改**自己的**资料。
 *
 * 目标用户来自网关注入的 UserContext（ADR 0003），**不接受调用方传 userId**——
 * 否则任何人都能改别人的昵称。
 *
 * 改昵称不影响已签发的 token：token 里只放 sub/jti/roles，不放任何会变的数据。
 * 这是那个决定的直接收益——改完不用强制重新登录。
 */
@Service
public class ProfileService {

    private static final Logger log = LoggerFactory.getLogger(ProfileService.class);

    private final UserMapper userMapper;
    private final LoginService loginService;

    public ProfileService(UserMapper userMapper, LoginService loginService) {
        this.userMapper = userMapper;
        this.loginService = loginService;
    }

    @Transactional
    public UserProfile update(Long userId, UpdateProfileRequest req) {
        // 复用同一套"账号仍可用"检查（未删除、未封禁）
        loginService.requireActiveUser(userId);

        if (req.nickname() == null && req.avatarUrl() == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "没有需要更新的字段");
        }

        // 必须用 UpdateWrapper 而不是 updateById：
        // MyBatis-Plus 默认忽略 null 字段，那样"清空头像"会变成"不改头像"。
        LambdaUpdateWrapper<User> update = new LambdaUpdateWrapper<User>().eq(User::getId, userId);
        if (req.nickname() != null) {
            update.set(User::getNickname, req.nickname().trim());
        }
        if (req.avatarUrl() != null) {
            String url = req.avatarUrl().trim();
            update.set(User::getAvatarUrl, url.isEmpty() ? null : url);
        }
        userMapper.update(null, update);

        log.info("资料已更新 userId={} nicknameChanged={} avatarChanged={}",
                userId, req.nickname() != null, req.avatarUrl() != null);

        // 重新读一次，返回库里真实的值（而不是我们以为写进去的值）
        return UserProfile.of(loginService.requireActiveUser(userId));
    }
}
