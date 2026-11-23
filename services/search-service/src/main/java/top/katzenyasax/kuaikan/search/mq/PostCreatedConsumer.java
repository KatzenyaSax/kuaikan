package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.PostCreated;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.search.service.PostIndexService;

/**
 * 发帖 → 建索引。组名 {@code kuaikan-search-post-created-consumer}。
 *
 * 载荷里没有 {@code authorNickname} / {@code communityName}（content 不是它们的所有者），
 * 由 {@link PostIndexService} 向 user / community 补齐后覆盖写。
 */
@Component
public class PostCreatedConsumer extends AbstractSearchEventConsumer<PostCreated> {

    private final PostIndexService postIndexService;

    public PostCreatedConsumer(
            PostIndexService postIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.post-created-consumer-group}") String consumerGroup) {
        super("search-post-created", namesrvAddr, consumerGroup,
                Topics.POST_CREATED, PostCreated.class, json);
        this.postIndexService = postIndexService;
    }

    @Override
    protected void handle(PostCreated event) {
        postIndexService.indexPost(event);
    }
}
