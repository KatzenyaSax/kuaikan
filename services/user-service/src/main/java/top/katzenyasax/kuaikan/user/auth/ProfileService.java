package top.katzenyasax.kuaikan.user.auth;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import top.katzenyasax.kuaikan.common.error.BizException;
import top.katzenyasax.kuaikan.common.error.CommonErrorCode;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.mq.UserProfileUpdated;
import top.katzenyasax.kuaikan.common.outbox.OutboxEvent;
import top.katzenyasax.kuaikan.common.outbox.OutboxMapper;
import top.katzenyasax.kuaikan.user.domain.User;
import top.katzenyasax.kuaikan.user.mapper.UserMapper;
import top.katzenyasax.kuaikan.user.web.dto.UpdateProfileRequest;
import top.katzenyasax.kuaikan.user.web.dto.UserProfile;

import java.time.LocalDateTime;
import java.util.UUID;

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
    private final OutboxMapper outboxMapper;
    private final ObjectMapper objectMapper;

    public ProfileService(UserMapper userMapper,
                          LoginService loginService,
                          OutboxMapper outboxMapper,
                          ObjectMapper objectMapper) {
        this.userMapper = userMapper;
        this.loginService = loginService;
        this.outboxMapper = outboxMapper;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public UserProfile update(Long userId, UpdateProfileRequest req) {
        // 复用同一套"账号仍可用"检查（未删除、未封禁）
        User before = loginService.requireActiveUser(userId);

        if (req.nickname() == null && req.avatarUrl() == null) {
            throw new BizException(CommonErrorCode.PARAM_INVALID, "没有需要更新的字段");
        }

        // 昵称是否**真的变了**：与入库前那一行比，而不是看请求里有没有这个字段。
        // 前端每次保存资料都会把昵称原样带上，按「传了就算改动」会让每次保存都
        // 触发一次全量 _update_by_query，代价是上百个索引文档重写。
        String newNickname = req.nickname() == null ? null : req.nickname().trim();
        boolean nicknameChanged = newNickname != null
                && !newNickname.equals(before.getNickname());

        // 必须用 UpdateWrapper 而不是 updateById：
        // MyBatis-Plus 默认忽略 null 字段，那样"清空头像"会变成"不改头像"。
        LambdaUpdateWrapper<User> update = new LambdaUpdateWrapper<User>().eq(User::getId, userId);
        if (req.nickname() != null) {
            update.set(User::getNickname, newNickname);
        }
        if (req.avatarUrl() != null) {
            String url = req.avatarUrl().trim();
            update.set(User::getAvatarUrl, url.isEmpty() ? null : url);
        }
        userMapper.update(null, update);

        // 昵称变了才发事件：与资料更新在**同一个本地事务**，
        // 事务提交 = 事件一定被记住；回滚 = 事件也不会留下。
        // 搜索索引靠它同步历史帖子里反范式拷贝的 authorNickname。
        if (nicknameChanged) {
            enqueueUserProfileUpdated(userId, newNickname);
        }

        log.info("资料已更新 userId={} nicknameChanged={} avatarChanged={}",
                userId, nicknameChanged, req.avatarUrl() != null);

        // 重新读一次，返回库里真实的值（而不是我们以为写进去的值）
        return UserProfile.of(loginService.requireActiveUser(userId));
    }

    /**
     * 写一条 {@link UserProfileUpdated} 到 outbox。
     *
     * 只能带 nickname：索引里只反范式了这一个字段，多承诺一个字段就等于
     * 承诺「以后改它也要发事件」，而消费方并没有地方用它。
     */
    private void enqueueUserProfileUpdated(Long userId, String nickname) {
        UserProfileUpdated event = new UserProfileUpdated(
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                String.valueOf(userId),
                nickname);

        OutboxEvent row = new OutboxEvent();
        row.setEventId(event.eventId());
        row.setTopic(Topics.USER_PROFILE_UPDATED);
        try {
            row.setPayload(objectMapper.writeValueAsString(event));
        } catch (Exception e) {
            // 序列化失败说明契约本身有问题，不能静默吞掉：整个事务回滚
            throw new IllegalStateException("事件序列化失败", e);
        }
        row.setStatus(OutboxEvent.STATUS_PENDING);
        row.setRetryCount(0);
        row.setNextRetryAt(LocalDateTime.now());
        outboxMapper.insert(row);
    }
}
