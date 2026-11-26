package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.PostCreated;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.search.service.VectorIndexService;

/**
 * 发帖 → 帖子向量切片索引（独立消费组，TEI 不可用不影响 P6 关键词搜索）。
 */
@Component
public class PostVectorCreatedConsumer extends AbstractSearchEventConsumer<PostCreated> {

    private final VectorIndexService vectorIndexService;

    public PostVectorCreatedConsumer(
            VectorIndexService vectorIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.post-vector-created-consumer-group}") String consumerGroup) {
        super("search-post-vector-created", namesrvAddr, consumerGroup,
                Topics.POST_CREATED, PostCreated.class, json);
        this.vectorIndexService = vectorIndexService;
    }

    @Override
    protected void handle(PostCreated event) {
        vectorIndexService.indexPostChunks(event);
    }
}
