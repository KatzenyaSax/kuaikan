package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.PostDeleted;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.search.service.VectorIndexService;

/**
 * 删帖 → 删除帖子向量切片索引（独立消费组）。
 */
@Component
public class PostVectorDeletedConsumer extends AbstractSearchEventConsumer<PostDeleted> {

    private final VectorIndexService vectorIndexService;

    public PostVectorDeletedConsumer(
            VectorIndexService vectorIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.post-vector-deleted-consumer-group}") String consumerGroup) {
        super("search-post-vector-deleted", namesrvAddr, consumerGroup,
                Topics.POST_DELETED, PostDeleted.class, json);
        this.vectorIndexService = vectorIndexService;
    }

    @Override
    protected void handle(PostDeleted event) {
        vectorIndexService.deletePostChunks(event.postId());
    }
}
