package top.katzenyasax.kuaikan.user.auth;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import top.katzenyasax.kuaikan.common.error.AuthErrorCode;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.ChangePasswordRequest;

/**
 * 修改密码 + 全端强制下线（P5.5.3）。
 *
 * <h2>检查顺序（每一步的代价都比上一步高，且错误的顺序会泄漏信息）</h2>
 *
 *   1. 账号仍可用（未删除 / 未封禁）—— 与 /auth/me 同一套语义
 *   2. 原密码与 t_user.password_hash 匹配，不匹配 {@code 40207}（**HTTP 200**）
 *   3. 新密码与原密码不同，相同 {@code 40208}（**HTTP 200**）
 *   4. 同一本地事务：改 password_hash + 吊销该用户全部未吊销的 refresh
 *   5. **事务提交之后**：清 Redis 里该用户的全部 access 白名单
 *
 * <h2>为什么 40207 / 40208 必须是 200 而不是 401</h2>
 *
 * 改密是已登录态的操作。返回 401 会让前端的 401 拦截器去调 /auth/refresh，
 * 把"原密码输错"变成"莫名掉线又莫名回来"，与 40206 同理（见 p1-auth.md §4）。
 *
 * <h2>为什么 DB 事务先提交、Redis 清理在后（顺序不可颠倒）</h2>
 *
 * 见 p55-social.md §6.2：若先清 Redis 后改库，改库失败就会把用户全端踢下线，
 * 而密码根本没变；反过来先提交事务、再清 Redis，即使 Redis 瞬时失败，
 * 所有 refresh 已吊销、且网关在 Redis 不可用时本身 fail-closed，
 * 最坏结果只是旧 access 自然过期（至多 2 小时）。
 *
 * 顺序靠 {@link TransactionTemplate} 显式表达：事务边界就是 execute() 的花括号，
 * 清 Redis 的那一行写在它外面，任何一次"顺手挪进去"的改动都会被肉眼看见。
 */
@Service
public class PasswordService {

    private static final Logger log = LoggerFactory.getLogger(PasswordService.class);

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final SessionService sessionService;
    private final LoginService loginService;
    private final TransactionTemplate transactionTemplate;

    public PasswordService(UserMapper userMapper,
                           PasswordEncoder passwordEncoder,
                           SessionService sessionService,
                           LoginService loginService,
                           TransactionTemplate transactionTemplate) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.sessionService = sessionService;
        this.loginService = loginService;
        this.transactionTemplate = transactionTemplate;
    }

    /** 本次改密实际撤销了多少凭证（只用于日志与排查，不影响响应体） */
    public record ChangeOutcome(long accessRevoked, int refreshRevoked) {
    }

    /**
     * 改密。**整个方法刻意不带 {@code @Transactional}**：
     * 事务只包住两条本地 SQL，Redis 清理必须在提交之后执行。
     */
    public ChangeOutcome change(Long userId, ChangePasswordRequest req) {
        // 1. 账号仍可用。封禁 / 注销走与 /auth/me 完全相同的分支
        User user = loginService.requireActiveUser(userId);

        // 2. 原密码必须匹配。注意这里**不区分**"用户不存在"与"密码错"——
        //    能走到这一步的一定是已登录用户，没有用户枚举面
        if (!passwordEncoder.matches(req.oldPassword(), user.getPasswordHash())) {
            throw new BizException(AuthErrorCode.PASSWORD_INCORRECT);
        }

        // 3. 新密码不能与原密码相同：命中时拒绝，避免一次无意义的全端踢下线
        if (passwordEncoder.matches(req.newPassword(), user.getPasswordHash())) {
            throw new BizException(AuthErrorCode.PASSWORD_UNCHANGED);
        }

        // BCrypt 故意慢（约 50~100ms）。放在事务外算：
        // 放进去等于让一个数据库连接白白被占这么久，并发一上来就耗池。
        String newHash = passwordEncoder.encode(req.newPassword());

        // 4. 同一本地事务：改哈希 + 吊销全部未吊销的 refresh
        Integer refreshRevoked = transactionTemplate.execute(status -> {
            userMapper.update(null, new LambdaUpdateWrapper<User>()
                    .eq(User::getId, userId)
                    .set(User::getPasswordHash, newHash));
            return sessionService.revokeAllForUser(userId);
        });

        // 5. 事务提交之后才动 Redis。万一这里抛异常，密码与 refresh 已经落库，
        //    网关 fail-closed，不会出现"密码没改却被踢下线"。
        long accessRevoked = sessionService.revokeAllAccess(userId);

        log.info("密码已修改 userId={} accessRevoked={} refreshRevoked={}",
                userId, accessRevoked, refreshRevoked == null ? 0 : refreshRevoked);
        return new ChangeOutcome(accessRevoked, refreshRevoked == null ? 0 : refreshRevoked);
    }
}
