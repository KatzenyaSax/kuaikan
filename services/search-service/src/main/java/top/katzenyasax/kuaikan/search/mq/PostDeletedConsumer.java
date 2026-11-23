package top.katzenyasax.kuaikan.search.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import top.katzenyasax.kuaikan.common.mq.PostDeleted;
import top.katzenyasax.kuaikan.common.mq.Topics;
import top.katzenyasax.kuaikan.search.service.PostIndexService;

/**
 * 删帖 → 删索引文档。组名 {@code kuaikan-search-post-deleted-consumer}。
 *
 * 删除必须真的删：保留一个"能搜到但点进去 404"的文档是搜索侧最刺眼的脏数据。
 * 文档不存在时 404 视为成功（重复投递的正常结果）。
 */
@Component
public class PostDeletedConsumer extends AbstractSearchEventConsumer<PostDeleted> {

    private final PostIndexService postIndexService;

    public PostDeletedConsumer(
            PostIndexService postIndexService,
            ObjectMapper json,
            @Value("${kuaikan.mq.namesrv-addr:127.0.0.1:9876}") String namesrvAddr,
            @Value("${kuaikan.search.post-deleted-consumer-group}") String consumerGroup) {
        super("search-post-deleted", namesrvAddr, consumerGroup,
                Topics.POST_DELETED, PostDeleted.class, json);
        this.postIndexService = postIndexService;
    }

    @Override
    protected void handle(PostDeleted event) {
        postIndexService.deletePost(event.postId());
    }
}
