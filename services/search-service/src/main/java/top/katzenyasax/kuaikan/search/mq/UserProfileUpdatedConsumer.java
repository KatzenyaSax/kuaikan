package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.common.mq.UserProfileUpdated;
import top.katzenyasax.kuaikan.search.service.PostIndexService;

/**
 * 改昵称 → 改写该作者**所有**历史帖文档。组名 {@code kuaikan-search-user-updated-consumer}。
 *
 * 昵称直接取事件载荷，不回查 user-service：载荷里就是新昵称快照，
 * 回查只会让一条本该幂等的消息多一个会失败的依赖。
 *
 * 匹配条件 {@code term authorId} 依赖 mapping 里 {@code authorId} 是 keyword。
 * 若它是 text，会被分词成"看起来能匹配、实际匹配不到"的样子（数字 id 恰好不会被切，
 * 所以这类错配在有中文的场景才会暴露，最难查）。
 */
@Component
public class UserProfileUpdatedConsumer extends AbstractSearchEventConsumer<UserProfileUpdated> {

    private final PostIndexService postIndexService;

    public UserProfileUpdatedConsumer(
            PostIndexService postIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.user-updated-consumer-group}") String consumerGroup) {
        super("search-user-updated", namesrvAddr, consumerGroup,
                Topics.USER_PROFILE_UPDATED, UserProfileUpdated.class, json);
        this.postIndexService = postIndexService;
    }

    @Override
    protected void handle(UserProfileUpdated event) {
        postIndexService.updateAuthorNickname(event.userId(), event.nickname());
    }
}
