package top.katzenyasax.kuaikan.user.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.domain.UserStatus;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;

import java.time.LocalDateTime;

/**
 * 平台级账号操作：踢下线、封禁、解封。
 *
 * 这些是**运维动作**，不走用户请求链路，因此没有 UserContext：
 * 目标用户由调用方**显式传入 userId**（ADR 0008 的规矩）。
 *
 * 入口只有 `/internal/admin/**`，而网关不路由 `/internal/**`（P0.5 的过滤器强制），
 * 所以只能从服务器上 docker exec 调用。如果哪天它出现在公网上，
 * 那一定是有人的 compose 写错了 ports。
 */
@Service
public class AccountAdminService {

    private static final Logger log = LoggerFactory.getLogger(AccountAdminService.class);

    private final UserMapper userMapper;
    private final SessionService sessionService;

    public AccountAdminService(UserMapper userMapper, SessionService sessionService) {
        this.userMapper = userMapper;
        this.sessionService = sessionService;
    }

    public record KickResult(long accessRevoked, int refreshRevoked) {
    }

    /**
     * 踢下线：让该用户**所有**已签发的凭证立即失效，但不改账号状态。
     *
     * 三步缺一不可：
     *   1. 删 Redis 里的 access 白名单（网关下一次请求就查不到 → 401）
     *   2. 吊销 DB 里全部 refresh（否则他能立刻用 refresh 换一对新的，等于没踢）
     *   3. 其他用户完全不受影响（这是按 familyId 局部吊销做不到的，必须按 userId）
     */
    @Transactional(noRollbackFor = BizException.class)
    public KickResult kick(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.NOT_FOUND);
        }
        long access = sessionService.revokeAllAccess(userId);
        int refresh = sessionService.revokeAllForUser(userId);
        log.warn("踢下线 userId={} accessRevoked={} refreshRevoked={}", userId, access, refresh);
        return new KickResult(access, refresh);
    }

    /**
     * 封禁：改账号状态 + 踢下线。
     *
     * 与踢下线的区别是「封禁会让下一次登录也被拒」（状态检查在 LoginService 里）。
     * 顺序上先改状态再撤销凭证：反过来的话，中间有个窗口他能重新登录一次。
     */
    @Transactional(noRollbackFor = BizException.class)
    public KickResult ban(Long userId, String reason) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.NOT_FOUND);
        }

        User patch = new User();
        patch.setId(userId);
        patch.setStatus(UserStatus.BANNED.code());
        patch.setBannedAt(LocalDateTime.now());
        patch.setBannedReason(reason);
        userMapper.updateById(patch);

        KickResult result = kick(userId);
        log.warn("封禁 userId={} reason={}", userId, reason);
        return result;
    }

    /** 解封：只改状态。之前被吊销的凭证需要用户重新登录 */
    @Transactional
    public void unban(Long userId) {
        User user = userMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new BizException(CommonErrorCode.NOT_FOUND);
        }
        User patch = new User();
        patch.setId(userId);
        patch.setStatus(UserStatus.NORMAL.code());
        userMapper.updateById(patch);
        // banned_at / banned_reason 是审计信息，解封不清空
        log.info("解封 userId={}", userId);
    }
}
